import { describe, expect, it } from "vitest";
import { extractPlainText } from "@/lib/documents/plain-text";
import { brand } from "@/config/brand";
import { slugify, cn, parseEmailList } from "@/lib/utils";
import { roleAtLeast } from "@/lib/roles";

describe("brand config", () => {
  it("exposes Docloom naming from a single source", () => {
    expect(brand.name).toBe("Docloom");
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
