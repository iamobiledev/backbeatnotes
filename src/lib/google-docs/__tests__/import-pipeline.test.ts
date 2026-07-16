import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { unzipHtmlExport } from "../zip";
import { htmlToTiptap } from "../html-to-tiptap";
import { normalizeDocumentBlocks } from "@/lib/documents/blocks";
import { extractPlainText } from "@/lib/documents/plain-text";

/**
 * End-to-end conversion pipeline without hitting Google/Drive.
 * Mirrors what importGoogleDoc does after the Drive export step.
 */
describe("google docs import pipeline (offline)", () => {
  it("converts a Drive-style HTML zip into searchable TipTap content", () => {
    const html = `
      <h1>Company Handbook</h1>
      <p>Welcome to <strong>Acme</strong>.</p>
      <ul><li>PTO policy</li><li>Expense reports</li></ul>
      <p><a href="https://docs.google.com/document/d/abc123/edit">Related doc</a></p>
      <table><tr><td>Role</td><td>Owner</td></tr></table>
    `;

    const zipped = zipSync({
      "handbook.html": strToU8(html),
      "images/unused.png": new Uint8Array([137, 80, 78, 71]),
    });

    const unzipped = unzipHtmlExport(zipped);
    const contentJson = htmlToTiptap(unzipped.html);
    const normalized = normalizeDocumentBlocks(contentJson);
    const plain = extractPlainText(normalized.contentJson);

    expect(normalized.contentJson.type).toBe("doc");
    expect(plain).toContain("Company Handbook");
    expect(plain).toContain("Acme");
    expect(plain).toContain("PTO policy");
    expect(plain).toContain("Role · Owner");
    expect(normalized.blocks.length).toBeGreaterThan(0);
    expect(
      normalized.blocks.some((b) => b.text.includes("Company Handbook")),
    ).toBe(true);
  });
});
