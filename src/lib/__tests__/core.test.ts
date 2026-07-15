import { describe, expect, it } from "vitest";
import { extractPlainText } from "@/lib/documents/plain-text";
import { brand } from "@/config/brand";
import { slugify, cn, parseEmailList } from "@/lib/utils";
import { roleAtLeast } from "@/lib/roles";
import {
  blockIdFromHash,
  blockUrlFragment,
  normalizeDocumentBlocks,
} from "@/lib/documents/blocks";

describe("brand config", () => {
  it("exposes BackBeat Notes naming from a single source", () => {
    expect(brand.name).toBe("BackBeat Notes");
    expect(brand.tagline).toContain("knowledge");
    expect(brand.title).toContain(brand.name);
  });
});

describe("extractPlainText", () => {
  it("flattens TipTap JSON into searchable text", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "heading",
          content: [{ type: "text", text: "Hello" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "World" }],
        },
      ],
    };
    expect(extractPlainText(doc)).toContain("Hello");
    expect(extractPlainText(doc)).toContain("World");
  });

  it("indexes sub-page block titles", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "subpage",
          attrs: { documentId: "abc", workspaceId: "ws", title: "Chapter 1" },
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Intro" }],
        },
      ],
    };
    expect(extractPlainText(doc)).toContain("Chapter 1");
    expect(extractPlainText(doc)).toContain("Intro");
  });
});

describe("document block anchors", () => {
  it("adds stable IDs and extracts nested paragraphs in document order", () => {
    let next = 0;
    const normalized = normalizeDocumentBlocks(
      {
        type: "doc",
        content: [
          {
            type: "heading",
            content: [{ type: "text", text: "Overview" }],
          },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Nested item" }],
                  },
                ],
              },
            ],
          },
        ],
      },
      { idFactory: () => `block_${++next}` },
    );

    expect(normalized.changed).toBe(true);
    expect(normalized.blocks).toEqual([
      {
        blockId: "block_1",
        blockType: "heading",
        position: 0,
        text: "Overview",
      },
      {
        blockId: "block_2",
        blockType: "paragraph",
        position: 1,
        text: "Nested item",
      },
    ]);
    expect(
      normalizeDocumentBlocks(normalized.contentJson, {
        idFactory: () => "unused_1",
      }),
    ).toMatchObject({ changed: false, blocks: normalized.blocks });
  });

  it("repairs duplicate IDs and can regenerate IDs for document copies", () => {
    const content = {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { blockId: "duplicate" } },
        { type: "paragraph", attrs: { blockId: "duplicate" } },
      ],
    };
    let next = 0;
    const repaired = normalizeDocumentBlocks(content, {
      idFactory: () => `fresh_${++next}`,
    });
    const ids = (repaired.contentJson.content as Array<{
      attrs: { blockId: string };
    }>).map((node) => node.attrs.blockId);
    expect(ids).toEqual(["duplicate", "fresh_1"]);

    const regenerated = normalizeDocumentBlocks(repaired.contentJson, {
      regenerateIds: true,
      idFactory: () => `copy_${++next}`,
    });
    expect(
      (regenerated.contentJson.content as Array<{
        attrs: { blockId: string };
      }>).map((node) => node.attrs.blockId),
    ).toEqual(["copy_2", "copy_3"]);
  });

  it("accepts only generated block URL fragments", () => {
    expect(blockUrlFragment("abc_123")).toBe("#block-abc_123");
    expect(blockIdFromHash("#block-abc_123")).toBe("abc_123");
    expect(blockIdFromHash("#other-abc_123")).toBeNull();
    expect(blockIdFromHash("#block-<script>")).toBeNull();
  });
});

describe("utils", () => {
  it("slugifies titles", () => {
    expect(slugify("Hello World!")).toBe("hello-world");
  });

  it("merges class names", () => {
    expect(cn("a", false && "b", "c")).toBe("a c");
  });
});

describe("parseEmailList", () => {
  it("splits on commas, semicolons, and whitespace", () => {
    expect(
      parseEmailList("a@example.com, b@example.com;c@example.com d@example.com"),
    ).toEqual({
      valid: [
        "a@example.com",
        "b@example.com",
        "c@example.com",
        "d@example.com",
      ],
      invalid: [],
    });
  });

  it("lowercases and dedupes", () => {
    expect(parseEmailList("A@Example.com, a@example.com")).toEqual({
      valid: ["a@example.com"],
      invalid: [],
    });
  });

  it("separates invalid tokens", () => {
    expect(parseEmailList("valid@example.com, not-an-email, @nope.com")).toEqual(
      {
        valid: ["valid@example.com"],
        invalid: ["not-an-email", "@nope.com"],
      },
    );
  });

  it("handles empty and whitespace-only input", () => {
    expect(parseEmailList("")).toEqual({ valid: [], invalid: [] });
    expect(parseEmailList("  ,, ;  ")).toEqual({ valid: [], invalid: [] });
  });
});

describe("permissions", () => {
  it("ranks roles correctly", () => {
    expect(roleAtLeast("admin", "member")).toBe(true);
    expect(roleAtLeast("guest", "member")).toBe(false);
    expect(roleAtLeast("owner", "admin")).toBe(true);
  });
});
