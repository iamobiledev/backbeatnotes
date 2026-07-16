import { describe, expect, it } from "vitest";
import { collectImageSrcs, htmlToTiptap } from "../html-to-tiptap";

describe("htmlToTiptap", () => {
  it("converts headings, paragraphs, and marks", () => {
    const json = htmlToTiptap(
      `<h1>Title</h1><p>Hello <strong>world</strong> and <em>friends</em>.</p>`,
    );
    expect(json.type).toBe("doc");
    const content = json.content as Array<Record<string, unknown>>;
    expect(content[0]).toMatchObject({
      type: "heading",
      attrs: { level: 1 },
    });
    expect(content[1]?.type).toBe("paragraph");
    const para = content[1] as {
      content: Array<{ text?: string; marks?: Array<{ type: string }> }>;
    };
    const bold = para.content.find((n) => n.text === "world");
    expect(bold?.marks?.some((m) => m.type === "bold")).toBe(true);
  });

  it("converts lists and task-like checklist items", () => {
    const json = htmlToTiptap(
      `<ul><li>One</li><li>Two</li></ul>
       <ul><li aria-checked="true">Done</li><li aria-checked="false">Todo</li></ul>`,
    );
    const content = json.content as Array<{ type: string; content?: unknown[] }>;
    expect(content.some((n) => n.type === "bulletList")).toBe(true);
    expect(content.some((n) => n.type === "taskList")).toBe(true);
  });

  it("maps links and flattens tables", () => {
    const json = htmlToTiptap(
      `<p><a href="https://docs.google.com/document/d/abc/edit">Other doc</a></p>
       <table><tr><td>A</td><td>B</td></tr></table>`,
    );
    const content = json.content as Array<Record<string, unknown>>;
    const para = content[0] as {
      content: Array<{ marks?: Array<{ type: string; attrs?: { href: string } }> }>;
    };
    expect(para.content[0]?.marks?.[0]).toMatchObject({
      type: "link",
      attrs: { href: "https://docs.google.com/document/d/abc/edit" },
    });
    const tablePara = content.find((n) => n.type === "paragraph" && n !== content[0]) as
      | { content?: Array<{ text?: string }> }
      | undefined;
    expect(tablePara?.content?.[0]?.text).toContain("A · B");
  });

  it("rewrites images via imageSrcMap and drops unmapped ones", () => {
    const map = new Map([["images/pic.png", "https://blob.example/pic.png"]]);
    const json = htmlToTiptap(
      `<p><img src="images/pic.png" alt="Pic"/><img src="missing.png"/></p>`,
      { imageSrcMap: map },
    );
    const content = json.content as Array<{
      type: string;
      content?: Array<{ type: string; attrs?: { src: string } }>;
      attrs?: { src: string };
    }>;
    const images = content.flatMap((block) => {
      if (block.type === "image") return [block];
      return (block.content ?? []).filter((n) => n.type === "image");
    });
    expect(images).toHaveLength(1);
    expect(images[0]?.attrs?.src).toBe("https://blob.example/pic.png");
  });

  it("returns an empty paragraph for blank HTML", () => {
    const json = htmlToTiptap("   ");
    expect(json).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
  });

  it("collects image srcs", () => {
    expect(
      collectImageSrcs(`<img src="a.png"/><img src="b.jpg"/>`),
    ).toEqual(["a.png", "b.jpg"]);
  });

  it("maps h4+ down to h3 and keeps code blocks", () => {
    const json = htmlToTiptap(`<h4>Deep</h4><pre>const x = 1;</pre>`);
    const content = json.content as Array<Record<string, unknown>>;
    expect(content[0]).toMatchObject({
      type: "heading",
      attrs: { level: 3 },
    });
    expect(content[1]?.type).toBe("codeBlock");
  });
});
