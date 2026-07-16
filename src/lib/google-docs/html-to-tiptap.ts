import { parseHTML } from "linkedom";

type JsonNode = {
  type: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
  content?: JsonNode[];
};

export type HtmlToTiptapOptions = {
  /**
   * Map original image `src` values (as they appear in HTML) to final URLs.
   * Missing mappings drop the image node.
   */
  imageSrcMap?: Map<string, string>;
};

function isElement(node: Node): node is Element {
  return node.nodeType === 1;
}

function isText(node: Node): node is Text {
  return node.nodeType === 3;
}

function tagName(el: Element): string {
  return el.tagName.toLowerCase();
}

function flattenMarks(
  marks: Array<{ type: string; attrs?: Record<string, unknown> }>,
): Array<{ type: string; attrs?: Record<string, unknown> }> {
  const seen = new Set<string>();
  const out: Array<{ type: string; attrs?: Record<string, unknown> }> = [];
  for (const mark of marks) {
    const key =
      mark.type === "link"
        ? `link:${mark.attrs?.href ?? ""}`
        : mark.type;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(mark);
  }
  return out;
}

function textNode(
  text: string,
  marks: Array<{ type: string; attrs?: Record<string, unknown> }>,
): JsonNode | null {
  if (!text) return null;
  // Collapse runs of whitespace but keep intentional spaces.
  const normalized = text.replace(/\u00a0/g, " ");
  if (!normalized) return null;
  const node: JsonNode = { type: "text", text: normalized };
  if (marks.length > 0) node.marks = flattenMarks(marks);
  return node;
}

function pushInline(target: JsonNode[], node: JsonNode | null) {
  if (!node) return;
  if (node.type === "text" && typeof node.text === "string") {
    const prev = target[target.length - 1];
    if (
      prev?.type === "text" &&
      typeof prev.text === "string" &&
      JSON.stringify(prev.marks ?? null) === JSON.stringify(node.marks ?? null)
    ) {
      prev.text += node.text;
      return;
    }
  }
  target.push(node);
}

function inlineFromNode(
  node: Node,
  marks: Array<{ type: string; attrs?: Record<string, unknown> }>,
  imageSrcMap?: Map<string, string>,
): JsonNode[] {
  if (isText(node)) {
    const t = textNode(node.data, marks);
    return t ? [t] : [];
  }
  if (!isElement(node)) return [];

  const el = node;
  const name = tagName(el);
  if (name === "script" || name === "style" || name === "meta" || name === "link") {
    return [];
  }
  if (name === "br") {
    return [{ type: "hardBreak" }];
  }
  if (name === "img") {
    const rawSrc = el.getAttribute("src")?.trim() ?? "";
    if (!rawSrc) return [];
    const mapped = imageSrcMap?.get(rawSrc) ?? imageSrcMap?.get(decodeURIComponent(rawSrc));
    if (!mapped) return [];
    const alt = el.getAttribute("alt") ?? "";
    return [
      {
        type: "image",
        attrs: { src: mapped, alt, title: null },
      },
    ];
  }

  const nextMarks = [...marks];
  if (name === "strong" || name === "b") nextMarks.push({ type: "bold" });
  if (name === "em" || name === "i") nextMarks.push({ type: "italic" });
  if (name === "s" || name === "del" || name === "strike") {
    nextMarks.push({ type: "strike" });
  }
  if (name === "code" && tagName(el.parentElement ?? el) !== "pre") {
    nextMarks.push({ type: "code" });
  }
  if (name === "a") {
    const href = el.getAttribute("href")?.trim();
    if (href && !href.startsWith("#")) {
      nextMarks.push({ type: "link", attrs: { href, target: "_blank" } });
    }
  }

  // Google Docs often wraps text in styled spans — inherit marks from CSS-ish hints.
  if (name === "span") {
    const style = (el.getAttribute("style") ?? "").toLowerCase();
    const weight = style.match(/font-weight:\s*(bold|[6-9]00)/);
    if (weight) nextMarks.push({ type: "bold" });
    if (style.includes("font-style:italic") || style.includes("font-style: italic")) {
      nextMarks.push({ type: "italic" });
    }
    if (
      style.includes("line-through") ||
      style.includes("text-decoration:line-through")
    ) {
      nextMarks.push({ type: "strike" });
    }
  }

  const out: JsonNode[] = [];
  for (const child of Array.from(el.childNodes)) {
    for (const inline of inlineFromNode(child, nextMarks, imageSrcMap)) {
      pushInline(out, inline);
    }
  }
  return out;
}

function paragraphFromElement(
  el: Element,
  imageSrcMap?: Map<string, string>,
): JsonNode {
  const content: JsonNode[] = [];
  for (const child of Array.from(el.childNodes)) {
    for (const inline of inlineFromNode(child, [], imageSrcMap)) {
      pushInline(content, inline);
    }
  }
  return content.length > 0
    ? { type: "paragraph", content }
    : { type: "paragraph" };
}

function isTaskListItem(li: Element): boolean {
  if (li.getAttribute("aria-checked") != null) return true;
  if (li.querySelector('input[type="checkbox"]')) return true;
  const cls = li.getAttribute("class") ?? "";
  return /checklist|task|todo/i.test(cls);
}

function listItemChecked(li: Element): boolean {
  const aria = li.getAttribute("aria-checked");
  if (aria === "true") return true;
  if (aria === "false") return false;
  const input = li.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
  return Boolean(input?.checked);
}

function convertList(
  el: Element,
  imageSrcMap?: Map<string, string>,
): JsonNode | null {
  const items = Array.from(el.children).filter((c) => tagName(c) === "li");
  if (items.length === 0) return null;

  const asTask = items.every(isTaskListItem);
  const listType = asTask
    ? "taskList"
    : tagName(el) === "ol"
      ? "orderedList"
      : "bulletList";

  const content: JsonNode[] = [];
  for (const li of items) {
    const nestedLists: JsonNode[] = [];
    const cloneChildren: Node[] = [];
    for (const child of Array.from(li.childNodes)) {
      if (
        isElement(child) &&
        (tagName(child) === "ul" || tagName(child) === "ol")
      ) {
        const nested = convertList(child, imageSrcMap);
        if (nested) nestedLists.push(nested);
      } else {
        cloneChildren.push(child);
      }
    }

    const inline: JsonNode[] = [];
    for (const child of cloneChildren) {
      if (
        isElement(child) &&
        (tagName(child) === "p" || tagName(child) === "div")
      ) {
        for (const n of inlineFromNode(child, [], imageSrcMap)) {
          pushInline(inline, n);
        }
      } else {
        for (const n of inlineFromNode(child, [], imageSrcMap)) {
          pushInline(inline, n);
        }
      }
    }

    const paragraph: JsonNode =
      inline.length > 0
        ? { type: "paragraph", content: inline }
        : { type: "paragraph" };

    if (asTask) {
      content.push({
        type: "taskItem",
        attrs: { checked: listItemChecked(li) },
        content: [paragraph, ...nestedLists],
      });
    } else {
      content.push({
        type: "listItem",
        content: [paragraph, ...nestedLists],
      });
    }
  }

  return { type: listType, content };
}

function flattenTable(
  table: Element,
  imageSrcMap?: Map<string, string>,
): JsonNode[] {
  const rows = Array.from(table.querySelectorAll("tr"));
  const paragraphs: JsonNode[] = [];
  for (const row of rows) {
    const cells = Array.from(row.children).filter(
      (c) => tagName(c) === "td" || tagName(c) === "th",
    );
    const parts: string[] = [];
    for (const cell of cells) {
      const inline = inlineFromNode(cell, [], imageSrcMap);
      const text = inline
        .map((n) => (n.type === "text" ? n.text ?? "" : n.type === "hardBreak" ? "\n" : ""))
        .join("")
        .replace(/\s+/g, " ")
        .trim();
      if (text) parts.push(text);
    }
    if (parts.length === 0) continue;
    paragraphs.push({
      type: "paragraph",
      content: [{ type: "text", text: parts.join(" · ") }],
    });
  }
  return paragraphs;
}

function convertBlock(
  el: Element,
  imageSrcMap?: Map<string, string>,
): JsonNode[] {
  const name = tagName(el);
  if (name === "script" || name === "style" || name === "head") return [];

  if (/^h[1-6]$/.test(name)) {
    const level = Math.min(3, Math.max(1, Number(name[1]))) as 1 | 2 | 3;
    const content: JsonNode[] = [];
    for (const child of Array.from(el.childNodes)) {
      for (const inline of inlineFromNode(child, [], imageSrcMap)) {
        // Headings can't contain images/hardBreaks cleanly — keep text + marks.
        if (inline.type === "text") pushInline(content, inline);
      }
    }
    return [
      content.length > 0
        ? { type: "heading", attrs: { level }, content }
        : { type: "heading", attrs: { level } },
    ];
  }

  if (name === "p") {
    return [paragraphFromElement(el, imageSrcMap)];
  }

  if (name === "pre") {
    const text = el.textContent ?? "";
    return [
      {
        type: "codeBlock",
        attrs: { language: null },
        content: text ? [{ type: "text", text }] : undefined,
      },
    ];
  }

  if (name === "blockquote") {
    // No dedicated blockquote in the editor schema for slash-commands, but
    // StarterKit includes it — still emit paragraphs for maximum compatibility.
    const out: JsonNode[] = [];
    for (const child of Array.from(el.children)) {
      out.push(...convertBlock(child, imageSrcMap));
    }
    if (out.length === 0) out.push(paragraphFromElement(el, imageSrcMap));
    return out;
  }

  if (name === "ul" || name === "ol") {
    const list = convertList(el, imageSrcMap);
    return list ? [list] : [];
  }

  if (name === "table") {
    return flattenTable(el, imageSrcMap);
  }

  if (name === "hr") {
    return [{ type: "horizontalRule" }];
  }

  if (name === "img") {
    const inline = inlineFromNode(el, [], imageSrcMap);
    if (inline.length === 1 && inline[0]?.type === "image") {
      return inline;
    }
    return [];
  }

  // Generic containers (div, body, section…): descend.
  if (
    name === "div" ||
    name === "section" ||
    name === "article" ||
    name === "main" ||
    name === "body" ||
    name === "html"
  ) {
    const out: JsonNode[] = [];
    let hasBlockChild = false;
    for (const child of Array.from(el.childNodes)) {
      if (isElement(child)) {
        const childName = tagName(child);
        if (
          /^h[1-6]$/.test(childName) ||
          childName === "p" ||
          childName === "ul" ||
          childName === "ol" ||
          childName === "pre" ||
          childName === "table" ||
          childName === "blockquote" ||
          childName === "div" ||
          childName === "hr" ||
          childName === "section" ||
          childName === "article"
        ) {
          hasBlockChild = true;
          out.push(...convertBlock(child, imageSrcMap));
        }
      }
    }
    if (!hasBlockChild) {
      // Treat as a paragraph-like container (common in Google HTML).
      const para = paragraphFromElement(el, imageSrcMap);
      if (para.content && para.content.length > 0) out.push(para);
    }
    return out;
  }

  // Unknown element: try paragraph extraction.
  const para = paragraphFromElement(el, imageSrcMap);
  return para.content && para.content.length > 0 ? [para] : [];
}

function extractBodyHtml(html: string): string {
  const trimmed = html.trim();
  // Prefer the innermost body contents when given a full document.
  const match = trimmed.match(/<body\b[^>]*>([\s\S]*)<\/body>/i);
  if (match?.[1] != null) return match[1];
  return trimmed;
}

/**
 * Convert Google Docs (or similar) HTML into TipTap/ProseMirror JSON.
 */
export function htmlToTiptap(
  html: string,
  opts: HtmlToTiptapOptions = {},
): Record<string, unknown> {
  const fragment = extractBodyHtml(html);
  const { document } = parseHTML(
    `<!DOCTYPE html><html><body>${fragment}</body></html>`,
  );
  const body = document.body;
  const content: JsonNode[] = [];

  if (body) {
    // Prefer converting from body children; Google often wraps everything in a div.
    for (const child of Array.from(body.childNodes)) {
      if (isElement(child)) {
        content.push(...convertBlock(child, opts.imageSrcMap));
      } else if (isText(child)) {
        const t = (child.data ?? "").replace(/\s+/g, " ").trim();
        if (t) {
          content.push({
            type: "paragraph",
            content: [{ type: "text", text: t }],
          });
        }
      }
    }
  }

  const cleaned = content.filter(Boolean);
  return {
    type: "doc",
    content:
      cleaned.length > 0
        ? cleaned
        : [{ type: "paragraph" }],
  };
}

/**
 * Collect image `src` values from HTML (for rehosting).
 */
export function collectImageSrcs(html: string): string[] {
  const { document } = parseHTML(`<!DOCTYPE html><html><body>${html}</body></html>`);
  const srcs: string[] = [];
  for (const img of Array.from(document.querySelectorAll("img"))) {
    const src = img.getAttribute("src")?.trim();
    if (src) srcs.push(src);
  }
  return srcs;
}
