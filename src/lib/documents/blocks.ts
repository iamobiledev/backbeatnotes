import { nanoid } from "nanoid";

export const BLOCK_ID_ATTRIBUTE = "blockId";
export const BLOCK_DOM_PREFIX = "block-";

const SEARCHABLE_BLOCK_TYPES = new Set(["paragraph", "heading", "codeBlock"]);
const BLOCK_ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;

type JsonNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: unknown[];
  [key: string]: unknown;
};

export type SearchableDocumentBlock = {
  blockId: string;
  blockType: string;
  position: number;
  text: string;
};

export type NormalizedDocumentBlocks = {
  contentJson: Record<string, unknown>;
  blocks: SearchableDocumentBlock[];
  changed: boolean;
};

export function isValidBlockId(value: unknown): value is string {
  return typeof value === "string" && BLOCK_ID_PATTERN.test(value);
}

export function isSearchableBlockType(type: string): boolean {
  return SEARCHABLE_BLOCK_TYPES.has(type);
}

export function blockDomId(blockId: string): string {
  if (!isValidBlockId(blockId)) throw new Error("Invalid block id");
  return `${BLOCK_DOM_PREFIX}${blockId}`;
}

export function blockUrlFragment(blockId: string): string {
  return `#${blockDomId(blockId)}`;
}

export function blockIdFromHash(hash: string): string | null {
  const value = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!value.startsWith(BLOCK_DOM_PREFIX)) return null;
  const blockId = value.slice(BLOCK_DOM_PREFIX.length);
  return isValidBlockId(blockId) ? blockId : null;
}

function textContent(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const current = node as JsonNode;
  if (typeof current.text === "string") return current.text;
  if (!Array.isArray(current.content)) return "";

  return current.content
    .map((child) => {
      const typed = child as JsonNode;
      if (typed?.type === "hardBreak") return "\n";
      return textContent(child);
    })
    .join("");
}

/**
 * Add stable IDs to searchable TipTap blocks and extract their text.
 *
 * The walk clones the input, so callers can safely compare/persist the result.
 * IDs only need to be unique within one document because the document route is
 * part of every deep link.
 */
export function normalizeDocumentBlocks(
  input: Record<string, unknown>,
  opts: {
    regenerateIds?: boolean;
    idFactory?: () => string;
  } = {},
): NormalizedDocumentBlocks {
  const idFactory = opts.idFactory ?? nanoid;
  const seen = new Set<string>();
  const blocks: SearchableDocumentBlock[] = [];
  let changed = false;

  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;

    const node = value as JsonNode;
    const clone: JsonNode = { ...node };
    if (node.attrs) clone.attrs = { ...node.attrs };

    if (node.type && SEARCHABLE_BLOCK_TYPES.has(node.type)) {
      const existing = clone.attrs?.[BLOCK_ID_ATTRIBUTE];
      let blockId =
        !opts.regenerateIds && isValidBlockId(existing) && !seen.has(existing)
          ? existing
          : "";

      if (!blockId) {
        do {
          blockId = idFactory();
        } while (!isValidBlockId(blockId) || seen.has(blockId));
        clone.attrs = { ...(clone.attrs ?? {}), [BLOCK_ID_ATTRIBUTE]: blockId };
        changed = true;
      }
      seen.add(blockId);

      const text = textContent(node).replace(/\s+/g, " ").trim();
      if (text) {
        blocks.push({
          blockId,
          blockType: node.type,
          position: blocks.length,
          text,
        });
      }
    }

    if (Array.isArray(node.content)) {
      clone.content = node.content.map(visit);
    }
    return clone;
  };

  return {
    contentJson: visit(input) as Record<string, unknown>,
    blocks,
    changed,
  };
}
