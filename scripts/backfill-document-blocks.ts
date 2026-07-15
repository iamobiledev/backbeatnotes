import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });
import { eq, isNull } from "drizzle-orm";
import { createDatabase } from "../src/db/create-db";
import { documents } from "../src/db/schema";
import { normalizeDocumentBlocks } from "../src/lib/documents/blocks";
import {
  refreshDocumentBlockEmbeddings,
  syncDocumentSearchBlocks,
} from "../src/lib/search/document-blocks";

const CONCURRENCY = 3;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const db = createDatabase(url);
  const rows = await db
    .select({
      id: documents.id,
      title: documents.title,
      contentJson: documents.contentJson,
    })
    .from(documents)
    .where(isNull(documents.archivedAt));

  const totals = {
    documents: rows.length,
    normalized: 0,
    blocks: 0,
    embeddingsAttempted: 0,
    embeddingsUpdated: 0,
    failures: 0,
  };
  let cursor = 0;

  const worker = async () => {
    while (cursor < rows.length) {
      const index = cursor++;
      const doc = rows[index];
      try {
        const normalized = normalizeDocumentBlocks(doc.contentJson);
        if (normalized.changed) {
          // Do not touch updated_at: adding internal IDs changes no visible
          // content and should not reorder users' recent documents.
          await db
            .update(documents)
            .set({ contentJson: normalized.contentJson })
            .where(eq(documents.id, doc.id));
          totals.normalized++;
        }

        const sync = await syncDocumentSearchBlocks({
          db,
          documentId: doc.id,
          title: doc.title,
          contentJson: normalized.contentJson,
        });
        totals.blocks += sync.blocks.length;

        const refreshed = await refreshDocumentBlockEmbeddings(doc.id);
        totals.embeddingsAttempted += refreshed.attempted;
        totals.embeddingsUpdated += refreshed.updated;
      } catch (error) {
        totals.failures++;
        console.error(
          JSON.stringify({
            documentId: doc.id,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, rows.length || 1) }, worker),
  );
  console.log(JSON.stringify(totals, null, 2));
  if (totals.failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
