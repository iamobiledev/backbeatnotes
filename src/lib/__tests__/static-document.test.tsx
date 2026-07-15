import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StaticDocument } from "@/components/documents/static-document";

describe("StaticDocument", () => {
  it("renders supported rich-text nodes without an editor runtime", () => {
    const html = renderToStaticMarkup(
      <StaticDocument
        contentJson={{
          type: "doc",
          content: [
            {
              type: "heading",
              attrs: { level: 2 },
              content: [{ type: "text", text: "Plan" }],
            },
            {
              type: "taskList",
              content: [
                {
                  type: "taskItem",
                  attrs: { checked: true },
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Ship it" }],
                    },
                  ],
                },
              ],
            },
            {
              type: "codeBlock",
              attrs: { language: "typescript" },
              content: [{ type: "text", text: "const fast = true;" }],
            },
          ],
        }}
      />,
    );

    expect(html).toContain("<h2>Plan</h2>");
    expect(html).toContain('data-type="taskList"');
    expect(html).toContain('checked=""');
    expect(html).toContain('class="language-typescript"');
    expect(html).toContain("const fast = true;");
  });

  it("escapes text and rejects executable links and image sources", () => {
    const html = renderToStaticMarkup(
      <StaticDocument
        contentJson={{
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "<script>alert(1)</script>",
                  marks: [
                    { type: "link", attrs: { href: "javascript:alert(1)" } },
                  ],
                },
              ],
            },
            { type: "image", attrs: { src: "javascript:alert(2)" } },
          ],
        }}
      />,
    );

    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<img");
  });
});
