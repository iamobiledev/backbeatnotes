import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { unzipHtmlExport } from "../zip";
import { htmlToTiptap } from "../html-to-tiptap";
import { normalizeDocumentBlocks } from "@/lib/documents/blocks";
import { extractPlainText } from "@/lib/documents/plain-text";

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);

/**
 * End-to-end conversion pipeline without hitting Google/Drive.
 * Mirrors what importGoogleDoc does after the Drive export step.
 */
describe("google docs import pipeline (offline)", () => {
  it("converts the sample Drive HTML zip fixture into searchable TipTap content", () => {
    const zipped = new Uint8Array(
      readFileSync(join(fixturesDir, "sample-doc.zip")),
    );

    const unzipped = unzipHtmlExport(zipped);
    const contentJson = htmlToTiptap(unzipped.html, {
      imageSrcMap: new Map([
        ["images/pic.png", "https://blob.example/pic.png"],
      ]),
    });
    const normalized = normalizeDocumentBlocks(contentJson);
    const plain = extractPlainText(normalized.contentJson);

    expect(normalized.contentJson.type).toBe("doc");
    expect(plain).toContain("Fixture Handbook");
    expect(plain).toContain("team");
    expect(plain).toContain("One");
    expect(plain).toContain("A · B");
    expect(normalized.blocks.length).toBeGreaterThan(0);
    expect(
      normalized.blocks.some((b) => b.text.includes("Fixture Handbook")),
    ).toBe(true);
  });
});
