const DRAFT_VERSION = 1;
const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type DocumentDraft = {
  version: typeof DRAFT_VERSION;
  baseSignature: string;
  title: string;
  contentJson: string;
  savedAt: number;
};

function draftKey(documentId: string) {
  return `docloom:draft:${documentId}`;
}

function isDocumentDraft(value: unknown): value is DocumentDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<DocumentDraft>;
  return (
    draft.version === DRAFT_VERSION &&
    typeof draft.baseSignature === "string" &&
    typeof draft.title === "string" &&
    typeof draft.contentJson === "string" &&
    typeof draft.savedAt === "number" &&
    Number.isFinite(draft.savedAt)
  );
}

export function readDocumentDraft(
  storage: Storage,
  documentId: string,
  now = Date.now(),
): DocumentDraft | null {
  try {
    const raw = storage.getItem(draftKey(documentId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      !isDocumentDraft(parsed) ||
      now - parsed.savedAt > DRAFT_MAX_AGE_MS ||
      parsed.savedAt > now + 60_000
    ) {
      storage.removeItem(draftKey(documentId));
      return null;
    }
    JSON.parse(parsed.contentJson);
    return parsed;
  } catch {
    return null;
  }
}

export function writeDocumentDraft(
  storage: Storage,
  documentId: string,
  draft: Omit<DocumentDraft, "version" | "savedAt">,
  now = Date.now(),
): void {
  try {
    storage.setItem(
      draftKey(documentId),
      JSON.stringify({
        version: DRAFT_VERSION,
        ...draft,
        savedAt: now,
      } satisfies DocumentDraft),
    );
  } catch {
    // Private browsing, storage quotas, and disabled storage must not break
    // editing. The in-memory editor remains the source until the next save.
  }
}

export function clearDocumentDraft(
  storage: Storage,
  documentId: string,
): void {
  try {
    storage.removeItem(draftKey(documentId));
  } catch {
    // See writeDocumentDraft.
  }
}
