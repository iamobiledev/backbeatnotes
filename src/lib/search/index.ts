import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import type {
  SearchHit,
  SearchQuery,
  SearchResult,
  SearchService,
  SemanticSearchQuery,
} from "./types";
import { logger } from "@/lib/logger";
import { measureServerOperation } from "@/lib/performance";
import { EMBEDDING_DIMENSIONS } from "@/lib/ai/embedding-config";
import { isMissingPostgresRelation } from "@/lib/db/errors";

function workspaceSetFilter(workspaceIds: string[] | undefined) {
  if (workspaceIds === undefined) return sql``;
  if (workspaceIds.length === 0) return sql`AND FALSE`;
  return sql`AND d.workspace_id IN (${sql.join(
    workspaceIds.map((id) => sql`${id}`),
    sql`, `,
  )})`;
}

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
    const workspaceIdsFilter = workspaceSetFilter(input.workspaceIds);
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
      const rows = await measureServerOperation(
        "search.query",
        () =>
          db.execute(sql`
        WITH params AS (
          SELECT
            ${q}::text AS query,
            lower(${q})::text AS normalized_query,
            plainto_tsquery('english', ${q}) AS ts_query
        ),
        accessible AS (
          SELECT d.*,
                 w.name AS workspace_name,
                 u.name AS creator_name,
                 (
                   CASE
                     WHEN lower(d.title) = p.normalized_query THEN 1000
                     WHEN lower(d.title) LIKE p.normalized_query || '%' THEN 800
                     WHEN similarity(d.title, p.query) > 0.45 THEN 600 + (similarity(d.title, p.query) * 100)
                     WHEN d.title ILIKE '%' || p.query || '%' THEN 400
                     WHEN d.search_vector @@ p.ts_query THEN 200 + ts_rank_cd(d.search_vector, p.ts_query) * 50
                     WHEN w.name ILIKE '%' || p.query || '%' THEN 60
                     WHEN u.name ILIKE '%' || p.query || '%' THEN 40
                     ELSE 0
                   END
                 ) + (EXTRACT(EPOCH FROM d.updated_at) / 1e12) AS score
          FROM documents d
          CROSS JOIN params p
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
            ${workspaceIdsFilter}
            ${ownerFilter}
            ${updatedFilter}
            ${parentFilter}
            AND (
              d.title ILIKE '%' || p.query || '%'
              OR d.title % p.query
              OR d.search_vector @@ p.ts_query
              OR w.name ILIKE '%' || p.query || '%'
              OR u.name ILIKE '%' || p.query || '%'
            )
        )
        SELECT
          id AS document_id,
          workspace_id,
          title,
          breadcrumb_path,
          CASE
            WHEN search_vector @@ params.ts_query THEN
              ts_headline(
                'english',
                LEFT(plain_text_content, 4000),
                params.ts_query,
                'StartSel=⟪, StopSel=⟫, MaxWords=28, MinWords=12, MaxFragments=1'
              )
            ELSE LEFT(plain_text_content, 180)
          END AS snippet,
          created_by_id AS creator_id,
          score,
          updated_at,
          workspace_name,
          creator_name
        FROM accessible
        CROSS JOIN params
        WHERE score > 0
        ORDER BY score DESC, updated_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `),
        { workspaceScoped: Boolean(input.workspaceId), limit, offset },
      );

      const resultRows = rows.rows as Array<Record<string, unknown>>;
      const total = resultRows.length;

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

  async semanticSearch(input: SemanticSearchQuery): Promise<SearchResult> {
    const query = input.query.trim();
    if (
      !query ||
      input.embedding.length !== EMBEDDING_DIMENSIONS ||
      input.workspaceIds.length === 0
    ) {
      return { hits: [], total: 0, query };
    }

    const limit = Math.min(input.limit ?? 3, 20);
    const candidateLimit = Math.max(limit * 12, 36);
    const embeddingLiteral = `[${input.embedding.join(",")}]`;
    const workspacesFilter = workspaceSetFilter(input.workspaceIds);
    const db = getDb();

    try {
      const rows = await db.execute(sql`
        WITH candidates AS (
          SELECT
            d.id AS document_id,
            d.workspace_id,
            d.title,
            d.breadcrumb_path,
            d.updated_at,
            d.created_by_id AS creator_id,
            w.name AS workspace_name,
            u.name AS creator_name,
            b.block_id,
            b.block_type,
            b.text_content,
            b.position,
            (b.embedding <=> ${embeddingLiteral}::vector) AS distance
          FROM document_search_blocks b
          INNER JOIN documents d ON d.id = b.document_id
          LEFT JOIN workspace_members wm
            ON wm.workspace_id = d.workspace_id
           AND wm.user_id = ${input.userId}
          LEFT JOIN document_permissions dp
            ON dp.document_id = d.id
           AND dp.user_id = ${input.userId}
          INNER JOIN workspaces w ON w.id = d.workspace_id
          INNER JOIN "user" u ON u.id = d.created_by_id
          WHERE d.archived_at IS NULL
            AND b.embedding IS NOT NULL
            AND (wm.user_id IS NOT NULL OR dp.user_id IS NOT NULL)
            AND (
              d.visibility <> 'private'
              OR d.created_by_id = ${input.userId}
              OR dp.user_id IS NOT NULL
            )
            ${workspacesFilter}
          ORDER BY b.embedding <=> ${embeddingLiteral}::vector
          LIMIT ${candidateLimit}
        ),
        best_per_document AS (
          SELECT DISTINCT ON (document_id)
            *
          FROM candidates
          ORDER BY document_id, distance ASC, position ASC
        )
        SELECT *
        FROM best_per_document
        ORDER BY distance ASC, updated_at DESC
        LIMIT ${limit}
      `);

      const resultRows = rows.rows as Array<Record<string, unknown>>;
      const hits: SearchHit[] = resultRows.map((row) => {
        const similarity = 1 - Number(row.distance ?? 1);
        return {
          documentId: String(row.document_id),
          workspaceId: String(row.workspace_id),
          title: String(row.title),
          breadcrumbPath: String(row.breadcrumb_path ?? ""),
          snippet: String(row.text_content ?? ""),
          score: similarity,
          updatedAt: new Date(String(row.updated_at)),
          workspaceName: row.workspace_name
            ? String(row.workspace_name)
            : undefined,
          creatorName: row.creator_name
            ? String(row.creator_name)
            : undefined,
          creatorId: row.creator_id ? String(row.creator_id) : undefined,
          matchedBlock: {
            blockId: String(row.block_id),
            blockType: String(row.block_type),
            text: String(row.text_content ?? ""),
            similarity,
          },
        };
      });
      return { hits, total: hits.length, query };
    } catch (error) {
      if (isMissingPostgresRelation(error, "document_search_blocks")) {
        logger.warn("search.semantic_schema_unavailable", {
          postgresCode: "42P01",
        });
        return { hits: [], total: 0, query };
      }
      logger.error("search.semantic_failed", {
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
