import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  documents,
  documentSearchBlocks,
  getDb,
  type Database,
} from "@/db";
import {
  normalizeDocumentBlocks,
  type SearchableDocumentBlock,
} from "@/lib/documents/blocks";
import { EMBEDDING_BLOCK_MAX_CHARS } from "@/lib/ai/embedding-config";
import {
  createOpenAIEmbeddings,
  isOpenAIEmbeddingsConfigured,
} from "@/lib/ai/openai-embeddings";
import { isMissingPostgresRelation } from "@/lib/db/errors";
import { logger } from "@/lib/logger";
import type { SearchHit } from "./types";

const EMBEDDING_BATCH_SIZE = 64;

export function buildBlockEmbeddingInput(opts: {
  title: string;
  blockType: string;
  text: string;
}): string {
  const title = opts.title.replace(/\s+/g, " ").trim().slice(0, 500);
  const text = opts.text
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, EMBEDDING_BLOCK_MAX_CHARS);
  return `Document: ${title || "Untitled"}\n${opts.blockType}: ${text}`;
}

export function embeddingInputHash(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export type PreparedSearchBlock = SearchableDocumentBlock & {
  embeddingInput: string;
  inputHash: string;
};

export function prepareDocumentSearchBlocks(opts: {
  title: string;
  contentJson: Record<string, unknown>;
}): {
  contentJson: Record<string, unknown>;
  blocks: PreparedSearchBlock[];
  changed: boolean;
} {
  const normalized = normalizeDocumentBlocks(opts.contentJson);
  return {
    contentJson: normalized.contentJson,
    changed: normalized.changed,
    blocks: normalized.blocks.map((block) => {
      const embeddingInput = buildBlockEmbeddingInput({
        title: opts.title,
        blockType: block.blockType,
        text: block.text,
      });
      return {
        ...block,
        embeddingInput,
        inputHash: embeddingInputHash(embeddingInput),
      };
    }),
  };
}

/**
 * Mirror the current document's searchable paragraphs into relational rows.
 * Changed inputs lose their stale vector immediately; unchanged blocks retain
 * their vector even when neighboring paragraphs are edited or reordered.
 */
export async function syncDocumentSearchBlocks(opts: {
  db: Database;
  documentId: string;
  title: string;
  contentJson: Record<string, unknown>;
  expectedRevision?: number;
}): Promise<{ blocks: PreparedSearchBlock[]; applied: boolean }> {
  const prepared = prepareDocumentSearchBlocks({
    title: opts.title,
    contentJson: opts.contentJson,
  });
  const input = prepared.blocks.map((block) => ({
    id: nanoid(),
    blockId: block.blockId,
    blockType: block.blockType,
    position: block.position,
    textContent: block.text.slice(0, EMBEDDING_BLOCK_MAX_CHARS),
    inputHash: block.inputHash,
  }));

  // Upsert and removal are one guarded SQL statement. This prevents an older
  // concurrent autosave from replacing a newer document's block generation,
  // and avoids partial generations if any part of the synchronization fails.
  const result = await opts.db.execute(sql`
    WITH current_document AS (
      SELECT id
      FROM documents
      WHERE id = ${opts.documentId}
        ${
          opts.expectedRevision !== undefined
            ? sql`AND revision = ${opts.expectedRevision}`
            : sql``
        }
    ),
    input_blocks AS (
      SELECT *
      FROM jsonb_to_recordset(${JSON.stringify(input)}::jsonb) AS block(
        id text,
        "blockId" text,
        "blockType" text,
        position integer,
        "textContent" text,
        "inputHash" text
      )
    ),
    upserted AS (
      INSERT INTO document_search_blocks (
        id,
        document_id,
        block_id,
        block_type,
        position,
        text_content,
        input_hash
      )
      SELECT
        block.id,
        ${opts.documentId},
        block."blockId",
        block."blockType",
        block.position,
        block."textContent",
        block."inputHash"
      FROM input_blocks block
      CROSS JOIN current_document
      ON CONFLICT (document_id, block_id) DO UPDATE SET
        block_type = EXCLUDED.block_type,
        position = EXCLUDED.position,
        text_content = EXCLUDED.text_content,
        input_hash = EXCLUDED.input_hash,
        embedding = CASE
          WHEN document_search_blocks.input_hash = EXCLUDED.input_hash
          THEN document_search_blocks.embedding
          ELSE NULL
        END,
        embedded_at = CASE
          WHEN document_search_blocks.input_hash = EXCLUDED.input_hash
          THEN document_search_blocks.embedded_at
          ELSE NULL
        END,
        updated_at = now()
      RETURNING block_id
    ),
    deleted AS (
      DELETE FROM document_search_blocks existing
      WHERE existing.document_id = ${opts.documentId}
        AND EXISTS (SELECT 1 FROM current_document)
        AND NOT EXISTS (
          SELECT 1
          FROM input_blocks current
          WHERE current."blockId" = existing.block_id
        )
      RETURNING existing.id
    )
    SELECT EXISTS (SELECT 1 FROM current_document) AS applied
  `);
  const row = result.rows[0] as { applied?: boolean } | undefined;
  return { blocks: prepared.blocks, applied: row?.applied === true };
}

export type DocumentSearchSyncOutcome =
  | { status: "synced"; blocks: number }
  | { status: "stale" }
  | { status: "schema-unavailable" }
  | { status: "failed" };

/**
 * Synchronize a derived search index without ever rejecting the canonical
 * document write.
 *
 * `expectedRevision` and the single guarded statement prevent an older
 * concurrent autosave from overwriting a newer index generation.
 */
export async function syncDocumentSearchIndexBestEffort(opts: {
  documentId: string;
  expectedRevision: number;
  title: string;
  contentJson: Record<string, unknown>;
}): Promise<DocumentSearchSyncOutcome> {
  try {
    const db = getDb();
    const result = await syncDocumentSearchBlocks({
      db,
      documentId: opts.documentId,
      title: opts.title,
      contentJson: opts.contentJson,
      expectedRevision: opts.expectedRevision,
    });
    if (!result.applied) return { status: "stale" };
    return { status: "synced", blocks: result.blocks.length };
  } catch (error) {
    if (isMissingPostgresRelation(error, "document_search_blocks")) {
      logger.warn("search.document_index_schema_unavailable", {
        documentId: opts.documentId,
        postgresCode: "42P01",
      });
      return { status: "schema-unavailable" };
    }
    logger.error("search.document_index_refresh_failed", {
      documentId: opts.documentId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { status: "failed" };
  }
}

export type EmbeddingRefreshResult = {
  attempted: number;
  updated: number;
};

/**
 * Embed only current rows that are missing a vector. The hash predicate on
 * every update makes slow provider responses safe under concurrent autosaves.
 */
export async function refreshDocumentBlockEmbeddings(
  documentId: string,
): Promise<EmbeddingRefreshResult> {
  if (!isOpenAIEmbeddingsConfigured()) return { attempted: 0, updated: 0 };

  const db = getDb();
  const [doc] = await db
    .select({ title: documents.title, archivedAt: documents.archivedAt })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);
  if (!doc || doc.archivedAt) return { attempted: 0, updated: 0 };

  const rows = await db
    .select({
      id: documentSearchBlocks.id,
      blockType: documentSearchBlocks.blockType,
      textContent: documentSearchBlocks.textContent,
      inputHash: documentSearchBlocks.inputHash,
    })
    .from(documentSearchBlocks)
    .where(
      and(
        eq(documentSearchBlocks.documentId, documentId),
        isNull(documentSearchBlocks.embedding),
      ),
    )
    .orderBy(asc(documentSearchBlocks.position));

  const currentRows = rows
    .map((row) => {
      const input = buildBlockEmbeddingInput({
        title: doc.title,
        blockType: row.blockType,
        text: row.textContent,
      });
      return embeddingInputHash(input) === row.inputHash
        ? { ...row, input }
        : null;
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  let updated = 0;
  for (let start = 0; start < currentRows.length; start += EMBEDDING_BATCH_SIZE) {
    const batch = currentRows.slice(start, start + EMBEDDING_BATCH_SIZE);
    const vectors = await createOpenAIEmbeddings(
      batch.map((row) => row.input),
    );
    if (!vectors) continue;

    for (let index = 0; index < batch.length; index++) {
      const row = batch[index];
      const changed = await db
        .update(documentSearchBlocks)
        .set({
          embedding: vectors[index],
          embeddedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(documentSearchBlocks.id, row.id),
            eq(documentSearchBlocks.inputHash, row.inputHash),
            isNull(documentSearchBlocks.embedding),
          ),
        )
        .returning({ id: documentSearchBlocks.id });
      updated += changed.length;
    }
  }

  logger.info("search.document_block_embeddings_refreshed", {
    documentId,
    attempted: currentRows.length,
    updated,
  });
  return { attempted: currentRows.length, updated };
}

function lexicalBlockScore(text: string, query: string): number {
  const normalizedText = text.toLocaleLowerCase();
  const normalizedQuery = query.toLocaleLowerCase().trim();
  if (!normalizedQuery) return 0;
  let score = normalizedText.includes(normalizedQuery) ? 100 : 0;
  const terms = normalizedQuery.match(/[\p{L}\p{N}]+/gu) ?? [];
  for (const term of terms) {
    if (term.length > 1 && normalizedText.includes(term)) score += 1;
  }
  return score;
}

/**
 * Add the strongest lexical paragraph to already-authorized document hits.
 * This powers anchored `/docs` and ordinary mention results without moving
 * permission filtering out of the primary search SQL.
 */
export async function attachLexicalBlockMatches(
  hits: SearchHit[],
  query: string,
): Promise<SearchHit[]> {
  if (hits.length === 0) return hits;
  const db = getDb();
  let rows: Array<{
    documentId: string;
    blockId: string;
    blockType: string;
    text: string;
    position: number;
  }>;
  try {
    rows = await db
      .select({
        documentId: documentSearchBlocks.documentId,
        blockId: documentSearchBlocks.blockId,
        blockType: documentSearchBlocks.blockType,
        text: documentSearchBlocks.textContent,
        position: documentSearchBlocks.position,
      })
      .from(documentSearchBlocks)
      .where(
        inArray(
          documentSearchBlocks.documentId,
          hits.map((hit) => hit.documentId),
        ),
      )
      .orderBy(asc(documentSearchBlocks.position));
  } catch (error) {
    if (isMissingPostgresRelation(error, "document_search_blocks")) {
      logger.warn("search.lexical_blocks_schema_unavailable", {
        postgresCode: "42P01",
      });
      return hits;
    }
    throw error;
  }

  const best = new Map<
    string,
    { blockId: string; blockType: string; text: string; score: number }
  >();
  const first = new Map<
    string,
    { blockId: string; blockType: string; text: string; score: number }
  >();
  for (const row of rows) {
    const score = lexicalBlockScore(row.text, query);
    if (!first.has(row.documentId)) {
      first.set(row.documentId, {
        blockId: row.blockId,
        blockType: row.blockType,
        text: row.text,
        score,
      });
    }
    if (score <= 0 || score <= (best.get(row.documentId)?.score ?? 0)) continue;
    best.set(row.documentId, {
      blockId: row.blockId,
      blockType: row.blockType,
      text: row.text,
      score,
    });
  }

  return hits.map((hit) => {
    const block = best.get(hit.documentId) ?? first.get(hit.documentId);
    return block
      ? {
          ...hit,
          matchedBlock: {
            blockId: block.blockId,
            blockType: block.blockType,
            text: block.text,
          },
        }
      : hit;
  });
}
