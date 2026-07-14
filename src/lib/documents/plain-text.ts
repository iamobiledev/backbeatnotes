/**
 * Extract plain text from TipTap / ProseMirror JSON for search indexing.
 */
export function extractPlainText(node: unknown): string {
  if (!node || typeof node !== "object") return "";

  const n = node as {
    type?: string;
    text?: string;
    content?: unknown[];
    attrs?: { title?: string };
  };

  if (n.text) return n.text;

  // Sub-page blocks carry their linked page title as an attribute.
  if (n.type === "subpage") return n.attrs?.title ?? "";

  if (!Array.isArray(n.content)) return "";

  const parts: string[] = [];
  for (const child of n.content) {
    const text = extractPlainText(child);
    if (text) parts.push(text);
  }

  const joined = parts.join(
    n.type === "paragraph" || n.type === "heading" || n.type === "listItem"
      ? "\n"
      : " ",
  );
  return joined.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function buildSearchVectorSql(title: string, plainText: string, breadcrumb: string) {
  // Used via raw SQL in document save — weighted A/B/C
  return { title, plainText, breadcrumb };
}
