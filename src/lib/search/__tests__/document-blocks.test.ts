import { describe, expect, it } from "vitest";
import {
  EMBEDDING_BLOCK_MAX_CHARS,
} from "@/lib/ai/embedding-config";
import {
  buildBlockEmbeddingInput,
  prepareDocumentSearchBlocks,
} from "../document-blocks";

describe("document search block preparation", () => {
  const contentJson = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { blockId: "stable_123" },
        content: [{ type: "text", text: "Reset emails never arrive." }],
      },
    ],
  };

  it("builds deterministic per-paragraph embedding hashes", () => {
    const first = prepareDocumentSearchBlocks({
      title: "Account help",
      contentJson,
    });
    const repeated = prepareDocumentSearchBlocks({
      title: "Account help",
      contentJson,
    });
    expect(first.blocks).toEqual(repeated.blocks);
    expect(first.blocks[0]).toMatchObject({
      blockId: "stable_123",
      text: "Reset emails never arrive.",
    });
    expect(first.blocks[0].inputHash).toHaveLength(64);

    const renamed = prepareDocumentSearchBlocks({
      title: "Authentication troubleshooting",
      contentJson,
    });
    expect(renamed.blocks[0].inputHash).not.toBe(first.blocks[0].inputHash);
  });

  it("bounds long paragraph input sent to the embedding provider", () => {
    const input = buildBlockEmbeddingInput({
      title: "Long doc",
      blockType: "paragraph",
      text: "x".repeat(EMBEDDING_BLOCK_MAX_CHARS + 2_000),
    });
    expect(input.length).toBeLessThan(
      EMBEDDING_BLOCK_MAX_CHARS + "Document: Long doc\nparagraph: ".length + 1,
    );
  });
});
