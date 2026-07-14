import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import type { SearchHit, SearchQuery, SearchResult, SearchService } from "./types";
import { logger } from "@/lib/logger";

/**
 * Neon Postgres search implementation.
 *
 * Ranking priority:
 * 1. Exact title match
 * 2. Title beginning with the query
 * 3. High-similarity fuzzy title match (pg_trgm)
 * 4. Title containing all search terms
 * 5. Body-content FTS match
 * 6. Recently updated as a secondary signal
 *
 * Permission filtering happens inside the SQL query — unauthorized
 * documents are never loaded into application memory.
 */
export class NeonSearchService implements SearchService {
  async search(input: SearchQuery): Promise<SearchResult> {
    const q = input.query.trim();
    if (!q) {
      return { hits: [], total: 0, query: q };
    }

    const limit = Math.min(input.limit ?? 20, 50);
    const offset = input.offset ?? 0;
    const db = getDb();

    const workspaceFilter = input.workspaceId
      ? sql`AND d.workspace_id = ${input.workspaceId}`
      : sql``;
    const ownerFilter = input.ownerId
      ? sql`AND d.created_by_id = ${input.ownerId}`
      : sql``;
    const updatedFilter = input.updatedAfter
      ? sql`AND d.updated_at >= ${input.updatedAfter.toISOString()}`
      : sql``;
    // Folder filter: restrict to the subtree rooted at parentId.
    const parentFilter = input.parentId
      ? sql`AND d.id IN (
          WITH RECURSIVE subtree AS (
            SELECT id FROM documents WHERE id = ${input.parentId}
            UNION ALL
            SELECT c.id FROM documents c INNER JOIN subtree s ON c.parent_id = s.id
          )
          SELECT id FROM subtree
        )`
      : sql``;

    try {
      const rows = await db.execute(sql`
        WITH accessible AS (
          SELECT d.*,
                 w.name AS workspace_name,
                 u.name AS creator_name,
                 similarity(lower(d.title), lower(${q})) AS title_sim,
                 (
                   CASE
                     WHEN lower(d.title) = lower(${q}) THEN 1000
                     WHEN lower(d.title) LIKE lower(${q}) || '%' THEN 800
                     WHEN similarity(lower(d.title), lower(${q})) > 0.45 THEN 600 + (similarity(lower(d.title), lower(${q})) * 100)
                     WHEN lower(d.title) LIKE '%' || lower(${q}) || '%' THEN 400
                     WHEN d.search_vector @@ plainto_tsquery('english', ${q}) THEN 200 + ts_rank_cd(d.search_vector, plainto_tsquery('english', ${q})) * 50
                     WHEN d.plain_text_content ILIKE '%' || ${q} || '%' THEN 100
                     WHEN d.breadcrumb_path ILIKE '%' || ${q} || '%' THEN 80
                     WHEN w.name ILIKE '%' || ${q} || '%' THEN 60
                     WHEN u.name ILIKE '%' || ${q} || '%' THEN 40
                     ELSE 0
                   END
                 ) + (EXTRACT(EPOCH FROM d.updated_at) / 1e12) AS score
          FROM documents d
          LEFT JOIN workspace_members wm
            ON wm.workspace_id = d.workspace_id
           AND wm.user_id = ${input.userId}
          LEFT JOIN document_permissions dp
            ON dp.document_id = d.id
           AND dp.user_id = ${input.userId}
          INNER JOIN workspaces w ON w.id = d.workspace_id
          INNER JOIN "user" u ON u.id = d.created_by_id
          WHERE d.archived_at IS NULL
            -- Permission mirror of computeDocumentAccess: workspace members
            -- or direct shares; private ("Only people invited") requires
            -- being the creator or holding a direct share.
            AND (wm.user_id IS NOT NULL OR dp.user_id IS NOT NULL)
            AND (
              d.visibility <> 'private'
              OR d.created_by_id = ${input.userId}
              OR dp.user_id IS NOT NULL
            )
            ${workspaceFilter}
            ${ownerFilter}
            ${updatedFilter}
            ${parentFilter}
            AND (
              lower(d.title) LIKE '%' || lower(${q}) || '%'
              OR similarity(lower(d.title), lower(${q})) > 0.3
              OR d.search_vector @@ plainto_tsquery('english', ${q})
              OR d.plain_text_content ILIKE '%' || ${q} || '%'
              OR d.breadcrumb_path ILIKE '%' || ${q} || '%'
              OR w.name ILIKE '%' || ${q} || '%'
              OR u.name ILIKE '%' || ${q} || '%'
            )
        )
        SELECT
          id AS document_id,
          workspace_id,
          title,
          breadcrumb_path,
          CASE
            WHEN search_vector @@ plainto_tsquery('english', ${q}) THEN
              ts_headline(
                'english',
                LEFT(plain_text_content, 4000),
                plainto_tsquery('english', ${q}),
                'StartSel=⟪, StopSel=⟫, MaxWords=28, MinWords=12, MaxFragments=1'
              )
            ELSE LEFT(plain_text_content, 180)
          END AS snippet,
          created_by_id AS creator_id,
          score,
          updated_at,
          workspace_name,
          creator_name,
          COUNT(*) OVER() AS total_count
        FROM accessible
        WHERE score > 0
        ORDER BY score DESC, updated_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `);

      const resultRows = rows.rows as Array<Record<string, unknown>>;
      const total =
        resultRows.length > 0 ? Number(resultRows[0].total_count ?? 0) : 0;

      const hits: SearchHit[] = resultRows.map((row) => ({
        documentId: String(row.document_id),
        workspaceId: String(row.workspace_id),
        title: String(row.title),
        breadcrumbPath: String(row.breadcrumb_path ?? ""),
        snippet: String(row.snippet ?? ""),
        score: Number(row.score ?? 0),
        updatedAt: new Date(String(row.updated_at)),
        workspaceName: row.workspace_name
          ? String(row.workspace_name)
          : undefined,
        creatorName: row.creator_name ? String(row.creator_name) : undefined,
        creatorId: row.creator_id ? String(row.creator_id) : undefined,
      }));

      return { hits, total, query: q };
    } catch (error) {
      logger.error("search.failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

let cached: SearchService | null = null;

export function getSearchService(): SearchService {
  if (!cached) {
    cached = new NeonSearchService();
  }
  return cached;
}
