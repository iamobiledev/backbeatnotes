import "server-only";
import { and, asc, desc, eq, isNull, isNotNull, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import {
  getDb,
  documents,
  documentVersions,
  favorites,
  recentlyViewed,
  workspaces,
  workspaceMembers,
  user,
  type Document,
  type Database,
} from "@/db";
import { requireMembership, getMembership } from "@/lib/permissions";
import {
  computeDocumentAccess,
  canManageWikiLock,
  canEdit,
  canView,
  type DocumentAccess,
  type PlatformRole,
} from "./access";
import { recordDocumentActivity } from "./activity";
import { shouldCreateVersion } from "./versioning";
import { extractPlainText } from "./plain-text";
import { slugify } from "@/lib/utils";
import { logger } from "@/lib/logger";

/* -------------------------------------------------------------------------- */
/* Access                                                                      */
/* -------------------------------------------------------------------------- */

export type DocumentWithAccess = {
  doc: Document;
  access: DocumentAccess;
  /** Requesting user's platform role (admin | developer). */
  platformRole: PlatformRole;
};

async function getPlatformRole(userId: string): Promise<PlatformRole> {
  const db = getDb();
  const [row] = await db
    .select({ role: user.role })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return row?.role === "admin" ? "admin" : "developer";
}

/**
 * Load a document and resolve the caller's access level.
 * Returns null when the document does not exist. Callers decide how to
 * render `access === "none"` (e.g. the request-access screen).
 */
export async function getDocumentWithAccess(
  userId: string,
  documentId: string,
): Promise<DocumentWithAccess | null> {
  const db = getDb();
  const [doc] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);
  if (!doc) return null;

  const [membership, platformRole] = await Promise.all([
    getMembership(userId, doc.workspaceId),
    getPlatformRole(userId),
  ]);
  const access = computeDocumentAccess({
    visibility: doc.visibility,
    isCreator: doc.createdById === userId,
    membershipRole: membership?.role ?? null,
    archived: doc.archivedAt !== null,
    docType: doc.docType,
    locked: doc.lockedAt !== null,
    platformRole,
  });
  return { doc, access, platformRole };
}

/** Like getDocumentWithAccess but throws unless the user can view. */
export async function getDocumentForUser(
  userId: string,
  documentId: string,
): Promise<Document | null> {
  const result = await getDocumentWithAccess(userId, documentId);
  if (!result) return null;
  if (!canView(result.access)) throw new Error("FORBIDDEN");
  return result.doc;
}

async function requireEditableDocument(
  userId: string,
  documentId: string,
): Promise<Document> {
  const result = await getDocumentWithAccess(userId, documentId);
  if (!result) throw new Error("NOT_FOUND");
  if (!canEdit(result.access)) throw new Error("FORBIDDEN");
  return result.doc;
}

/** SQL fragment: exclude private docs the user did not create (defensive). */
function visibleTo(userId: string) {
  return sql`(${documents.visibility} <> 'private' OR ${documents.createdById} = ${userId})`;
}

/* -------------------------------------------------------------------------- */
/* Listing                                                                     */
/* -------------------------------------------------------------------------- */

export type { DocumentTreeNode } from "./types";
import type { DocumentTreeNode } from "./types";

export async function listWorkspaceDocuments(
  userId: string,
  workspaceId: string,
) {
  await requireMembership(userId, workspaceId, "guest");
  const db = getDb();
  return db
    .select({
      id: documents.id,
      title: documents.title,
      parentId: documents.parentId,
      visibility: documents.visibility,
      publicSlug: documents.publicSlug,
      icon: documents.icon,
      docType: documents.docType,
      lockedAt: documents.lockedAt,
      updatedAt: documents.updatedAt,
      createdById: documents.createdById,
    })
    .from(documents)
    .where(
      and(
        eq(documents.workspaceId, workspaceId),
        isNull(documents.archivedAt),
        visibleTo(userId),
      ),
    )
    .orderBy(asc(documents.title));
}

/** Flat list assembled into a tree for the sidebar. */
export async function listWorkspaceDocumentTree(
  userId: string,
  workspaceId: string,
): Promise<DocumentTreeNode[]> {
  const rows = await listWorkspaceDocuments(userId, workspaceId);
  const nodes = new Map<string, DocumentTreeNode>();
  for (const row of rows) {
    nodes.set(row.id, {
      id: row.id,
      title: row.title,
      parentId: row.parentId,
      icon: row.icon,
      visibility: row.visibility,
      docType: row.docType,
      locked: row.lockedAt !== null,
      updatedAt: row.updatedAt,
      createdById: row.createdById,
      children: [],
    });
  }
  const roots: DocumentTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortRec = (list: DocumentTreeNode[]) => {
    list.sort((a, b) => a.title.localeCompare(b.title));
    for (const item of list) sortRec(item.children);
  };
  sortRec(roots);
  return roots;
}

export async function getRecentDocuments(userId: string, workspaceId: string) {
  await requireMembership(userId, workspaceId, "guest");
  const db = getDb();

  // Prefer the user's actual view history; fall back to recently updated.
  const viewed = await db
    .select({
      id: documents.id,
      title: documents.title,
      icon: documents.icon,
      updatedAt: documents.updatedAt,
      viewedAt: recentlyViewed.viewedAt,
    })
    .from(recentlyViewed)
    .innerJoin(documents, eq(documents.id, recentlyViewed.documentId))
    .where(
      and(
        eq(recentlyViewed.userId, userId),
        eq(documents.workspaceId, workspaceId),
        isNull(documents.archivedAt),
        visibleTo(userId),
      ),
    )
    .orderBy(desc(recentlyViewed.viewedAt))
    .limit(12);

  if (viewed.length >= 4) return viewed;

  const updated = await db
    .select({
      id: documents.id,
      title: documents.title,
      icon: documents.icon,
      updatedAt: documents.updatedAt,
      viewedAt: documents.updatedAt,
    })
    .from(documents)
    .where(
      and(
        eq(documents.workspaceId, workspaceId),
        isNull(documents.archivedAt),
        visibleTo(userId),
      ),
    )
    .orderBy(desc(documents.updatedAt))
    .limit(12);

  const seen = new Set(viewed.map((d) => d.id));
  return [...viewed, ...updated.filter((d) => !seen.has(d.id))].slice(0, 12);
}

export async function recordDocumentView(userId: string, documentId: string) {
  const db = getDb();
  await db
    .insert(recentlyViewed)
    .values({ id: nanoid(), userId, documentId, viewedAt: new Date() })
    .onConflictDoUpdate({
      target: [recentlyViewed.userId, recentlyViewed.documentId],
      set: { viewedAt: new Date() },
    });
}

/* -------------------------------------------------------------------------- */
/* Favorites                                                                   */
/* -------------------------------------------------------------------------- */

export async function toggleFavorite(userId: string, documentId: string) {
  const result = await getDocumentWithAccess(userId, documentId);
  if (!result || !canView(result.access)) throw new Error("FORBIDDEN");
  const db = getDb();
  const [existing] = await db
    .select({ id: favorites.id })
    .from(favorites)
    .where(
      and(eq(favorites.userId, userId), eq(favorites.documentId, documentId)),
    )
    .limit(1);
  if (existing) {
    await db.delete(favorites).where(eq(favorites.id, existing.id));
    return { favorited: false };
  }
  await db.insert(favorites).values({ id: nanoid(), userId, documentId });
  return { favorited: true };
}

export async function listFavoriteDocuments(
  userId: string,
  workspaceId: string,
) {
  await requireMembership(userId, workspaceId, "guest");
  const db = getDb();
  return db
    .select({
      id: documents.id,
      title: documents.title,
      icon: documents.icon,
      updatedAt: documents.updatedAt,
    })
    .from(favorites)
    .innerJoin(documents, eq(documents.id, favorites.documentId))
    .where(
      and(
        eq(favorites.userId, userId),
        eq(documents.workspaceId, workspaceId),
        isNull(documents.archivedAt),
        visibleTo(userId),
      ),
    )
    .orderBy(desc(favorites.createdAt));
}

export async function isFavorited(userId: string, documentId: string) {
  const db = getDb();
  const [row] = await db
    .select({ id: favorites.id })
    .from(favorites)
    .where(
      and(eq(favorites.userId, userId), eq(favorites.documentId, documentId)),
    )
    .limit(1);
  return Boolean(row);
}

/* -------------------------------------------------------------------------- */
/* Create / save                                                               */
/* -------------------------------------------------------------------------- */

export async function createDocument(opts: {
  userId: string;
  workspaceId: string;
  parentId?: string | null;
  title?: string;
  docType?: "doc" | "wiki";
}) {
  await requireMembership(opts.userId, opts.workspaceId, "member");
  const db = getDb();
  const id = nanoid();
  const title = opts.title?.trim() || "Untitled";

  let parentId: string | null = opts.parentId ?? null;
  let breadcrumbPath = title;
  if (parentId) {
    const [parent] = await db
      .select({
        workspaceId: documents.workspaceId,
        title: documents.title,
        breadcrumbPath: documents.breadcrumbPath,
      })
      .from(documents)
      .where(eq(documents.id, parentId))
      .limit(1);
    if (!parent || parent.workspaceId !== opts.workspaceId) {
      parentId = null;
    } else {
      breadcrumbPath = `${parent.breadcrumbPath || parent.title} / ${title}`;
    }
  }

  const [doc] = await db
    .insert(documents)
    .values({
      id,
      workspaceId: opts.workspaceId,
      parentId,
      title,
      breadcrumbPath,
      docType: opts.docType ?? "doc",
      contentJson: {
        type: "doc",
        content: [{ type: "paragraph" }],
      },
      plainTextContent: "",
      createdById: opts.userId,
      updatedById: opts.userId,
    })
    .returning();

  await recordDocumentActivity({
    documentId: doc.id,
    userId: opts.userId,
    action: "created",
    metadata: { docType: doc.docType },
  });

  return doc;
}

/* -------------------------------------------------------------------------- */
/* Sub-page blocks                                                             */
/* -------------------------------------------------------------------------- */

function collectSubpageIds(node: unknown, ids: Set<string>) {
  if (!node || typeof node !== "object") return;
  const n = node as {
    type?: string;
    attrs?: { documentId?: string };
    content?: unknown[];
  };
  if (n.type === "subpage" && n.attrs?.documentId) {
    ids.add(n.attrs.documentId);
  }
  if (Array.isArray(n.content)) {
    for (const child of n.content) collectSubpageIds(child, ids);
  }
}

function patchSubpageTitles(
  node: unknown,
  titles: Map<string, string>,
): unknown {
  if (!node || typeof node !== "object") return node;
  const n = node as {
    type?: string;
    attrs?: { documentId?: string; title?: string };
    content?: unknown[];
  };
  let next = n;
  if (n.type === "subpage" && n.attrs?.documentId) {
    const title = titles.get(n.attrs.documentId);
    if (title !== undefined && title !== n.attrs.title) {
      next = { ...n, attrs: { ...n.attrs, title } };
    }
  }
  if (Array.isArray(next.content)) {
    const original = next.content;
    const patched = original.map((child) => patchSubpageTitles(child, titles));
    if (patched.some((child, index) => child !== original[index])) {
      next = { ...next, content: patched };
    }
  }
  return next;
}

/**
 * Refresh the `title` attribute of sub-page blocks in TipTap JSON so that
 * renamed child pages stay in sync wherever the parent document is rendered.
 */
export async function refreshSubpageTitles(
  contentJson: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const ids = new Set<string>();
  collectSubpageIds(contentJson, ids);
  if (ids.size === 0) return contentJson;

  const db = getDb();
  const rows = await db
    .select({ id: documents.id, title: documents.title })
    .from(documents)
    .where(inArray(documents.id, [...ids]));
  const titles = new Map(rows.map((row) => [row.id, row.title]));
  return patchSubpageTitles(contentJson, titles) as Record<string, unknown>;
}

export async function saveDocumentContent(opts: {
  userId: string;
  documentId: string;
  title?: string;
  contentJson: Record<string, unknown>;
}) {
  const existing = await requireEditableDocument(opts.userId, opts.documentId);

  const title = opts.title?.trim() || existing.title;
  const plainTextContent = extractPlainText(opts.contentJson);
  const db = getDb();

  // Snapshot the previous state when the edit is significant.
  const [latestVersion] = await db
    .select({
      version: documentVersions.version,
      createdAt: documentVersions.createdAt,
    })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, existing.id))
    .orderBy(desc(documentVersions.version))
    .limit(1);

  const createVersion = shouldCreateVersion({
    lastVersionAt: latestVersion?.createdAt ?? null,
    previousTitle: existing.title,
    nextTitle: title,
    previousPlainText: existing.plainTextContent,
    nextPlainText: plainTextContent,
  });

  if (createVersion) {
    await db.insert(documentVersions).values({
      id: nanoid(),
      documentId: existing.id,
      version: (latestVersion?.version ?? 0) + 1,
      title: existing.title,
      contentJson: existing.contentJson,
      plainTextContent: existing.plainTextContent,
      createdById: opts.userId,
    });
  }

  const [updated] = await db
    .update(documents)
    .set({
      title,
      contentJson: opts.contentJson,
      plainTextContent,
      updatedById: opts.userId,
      updatedAt: new Date(),
    })
    .where(eq(documents.id, existing.id))
    .returning();

  if (title !== existing.title) {
    await recomputeBreadcrumbs(db, existing.id);
    // Refresh the sidebar tree (and any sub-page links) that show this title.
    revalidatePath(`/app/${existing.workspaceId}`, "layout");
    await recordDocumentActivity({
      documentId: existing.id,
      userId: opts.userId,
      action: "renamed",
      metadata: { from: existing.title, to: title },
    });
  }

  const charDelta = plainTextContent.length - existing.plainTextContent.length;
  if (plainTextContent !== existing.plainTextContent) {
    await recordDocumentActivity({
      documentId: existing.id,
      userId: opts.userId,
      action: "edited",
      metadata: { charDelta },
    });
  }

  if (existing.visibility === "public" && existing.publicSlug) {
    revalidatePath(`/p/${existing.publicSlug}`);
  }

  // Notify participants after the response is sent (throttled inside).
  after(async () => {
    const { notifyDocumentEdited } = await import("@/lib/notifications");
    const [actor] = await db
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, opts.userId))
      .limit(1);
    await notifyDocumentEdited({
      doc: {
        id: updated.id,
        workspaceId: updated.workspaceId,
        title: updated.title,
        createdById: updated.createdById,
      },
      actorId: opts.userId,
      actorName: actor?.name ?? "Someone",
    });
  });

  return updated;
}

export async function renameDocument(opts: {
  userId: string;
  documentId: string;
  title: string;
}) {
  const existing = await requireEditableDocument(opts.userId, opts.documentId);
  const title = opts.title.trim() || "Untitled";
  const db = getDb();
  const [updated] = await db
    .update(documents)
    .set({ title, updatedById: opts.userId, updatedAt: new Date() })
    .where(eq(documents.id, existing.id))
    .returning();
  await recomputeBreadcrumbs(db, existing.id);
  await recordDocumentActivity({
    documentId: existing.id,
    userId: opts.userId,
    action: "renamed",
    metadata: { from: existing.title, to: title },
  });
  return updated;
}

/* -------------------------------------------------------------------------- */
/* Wiki locking                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Lock or unlock a wiki. Only workspace owners/admins and platform admins.
 * Locked wikis are read-only for everyone else (see computeDocumentAccess).
 */
export async function setDocumentLock(opts: {
  userId: string;
  documentId: string;
  locked: boolean;
}) {
  const result = await getDocumentWithAccess(opts.userId, opts.documentId);
  if (!result) throw new Error("NOT_FOUND");
  if (!canView(result.access)) throw new Error("FORBIDDEN");
  if (result.doc.docType !== "wiki") throw new Error("NOT_A_WIKI");

  const membership = await getMembership(opts.userId, result.doc.workspaceId);
  if (
    !canManageWikiLock({
      membershipRole: membership?.role ?? null,
      platformRole: result.platformRole,
    })
  ) {
    throw new Error("FORBIDDEN");
  }

  const db = getDb();
  const [updated] = await db
    .update(documents)
    .set({
      lockedAt: opts.locked ? new Date() : null,
      lockedById: opts.locked ? opts.userId : null,
      updatedAt: new Date(),
    })
    .where(eq(documents.id, result.doc.id))
    .returning();

  await recordDocumentActivity({
    documentId: result.doc.id,
    userId: opts.userId,
    action: opts.locked ? "locked" : "unlocked",
  });
  logger.info("document.lock", {
    documentId: result.doc.id,
    locked: opts.locked,
  });
  return updated;
}

/* -------------------------------------------------------------------------- */
/* Hierarchy                                                                   */
/* -------------------------------------------------------------------------- */

/** Recompute breadcrumb paths for a document and all of its descendants. */
async function recomputeBreadcrumbs(db: Database, rootId: string) {
  const [root] = await db
    .select({ id: documents.id, workspaceId: documents.workspaceId })
    .from(documents)
    .where(eq(documents.id, rootId))
    .limit(1);
  if (!root) return;

  const rows = await db
    .select({
      id: documents.id,
      parentId: documents.parentId,
      title: documents.title,
      breadcrumbPath: documents.breadcrumbPath,
    })
    .from(documents)
    .where(eq(documents.workspaceId, root.workspaceId));

  const byId = new Map(rows.map((r) => [r.id, r]));
  const pathFor = (id: string, seen = new Set<string>()): string => {
    const row = byId.get(id);
    if (!row || seen.has(id)) return "";
    seen.add(id);
    if (!row.parentId) return row.title;
    const parentPath = pathFor(row.parentId, seen);
    return parentPath ? `${parentPath} / ${row.title}` : row.title;
  };

  // Collect the subtree rooted at rootId.
  const children = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parentId) continue;
    const list = children.get(row.parentId) ?? [];
    list.push(row.id);
    children.set(row.parentId, list);
  }
  const subtree: string[] = [];
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift()!;
    subtree.push(id);
    queue.push(...(children.get(id) ?? []));
  }

  for (const id of subtree) {
    const next = pathFor(id);
    const row = byId.get(id);
    if (row && next && next !== row.breadcrumbPath) {
      await db
        .update(documents)
        .set({ breadcrumbPath: next })
        .where(eq(documents.id, id));
    }
  }
}

export async function moveDocument(opts: {
  userId: string;
  documentId: string;
  newParentId: string | null;
}) {
  const existing = await requireEditableDocument(opts.userId, opts.documentId);
  const db = getDb();

  if (opts.newParentId) {
    if (opts.newParentId === existing.id) throw new Error("INVALID_PARENT");
    const [parent] = await db
      .select({
        id: documents.id,
        workspaceId: documents.workspaceId,
        parentId: documents.parentId,
        archivedAt: documents.archivedAt,
      })
      .from(documents)
      .where(eq(documents.id, opts.newParentId))
      .limit(1);
    if (!parent || parent.workspaceId !== existing.workspaceId || parent.archivedAt) {
      throw new Error("INVALID_PARENT");
    }
    // Prevent cycles: walk up from the new parent.
    let cursor: string | null = parent.parentId;
    const guard = new Set<string>([parent.id]);
    while (cursor) {
      if (cursor === existing.id) throw new Error("INVALID_PARENT");
      if (guard.has(cursor)) break;
      guard.add(cursor);
      const [row] = await db
        .select({ parentId: documents.parentId })
        .from(documents)
        .where(eq(documents.id, cursor))
        .limit(1);
      cursor = row?.parentId ?? null;
    }
  }

  const [updated] = await db
    .update(documents)
    .set({
      parentId: opts.newParentId,
      updatedById: opts.userId,
      updatedAt: new Date(),
    })
    .where(eq(documents.id, existing.id))
    .returning();
  await recomputeBreadcrumbs(db, existing.id);
  await recordDocumentActivity({
    documentId: existing.id,
    userId: opts.userId,
    action: "moved",
  });
  return updated;
}

/** Ancestor chain (root → … → parent) for breadcrumbs in the doc header. */
export async function getDocumentAncestors(documentId: string) {
  const db = getDb();
  const result = await db.execute(sql`
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_id, title, 0 AS depth
      FROM documents WHERE id = ${documentId}
      UNION ALL
      SELECT d.id, d.parent_id, d.title, a.depth + 1
      FROM documents d
      INNER JOIN ancestors a ON d.id = a.parent_id
      WHERE a.depth < 20
    )
    SELECT id, title FROM ancestors WHERE id <> ${documentId} ORDER BY depth DESC
  `);
  return (result.rows as Array<{ id: string; title: string }>) ?? [];
}

/* -------------------------------------------------------------------------- */
/* Trash                                                                       */
/* -------------------------------------------------------------------------- */

async function getSubtreeIds(db: Database, rootId: string): Promise<string[]> {
  const result = await db.execute(sql`
    WITH RECURSIVE subtree AS (
      SELECT id FROM documents WHERE id = ${rootId}
      UNION ALL
      SELECT d.id FROM documents d INNER JOIN subtree s ON d.parent_id = s.id
    )
    SELECT id FROM subtree
  `);
  return (result.rows as Array<{ id: string }>).map((r) => r.id);
}

/** Move a document (and its descendants) to the trash. */
export async function trashDocument(opts: {
  userId: string;
  documentId: string;
}) {
  const result = await getDocumentWithAccess(opts.userId, opts.documentId);
  if (!result) throw new Error("NOT_FOUND");
  // Trashing requires edit rights on the live document.
  if (result.doc.archivedAt) return result.doc;
  if (result.access !== "editor") throw new Error("FORBIDDEN");

  const db = getDb();
  const ids = await getSubtreeIds(db, result.doc.id);
  await db
    .update(documents)
    .set({ archivedAt: new Date(), updatedById: opts.userId })
    .where(and(inArray(documents.id, ids), isNull(documents.archivedAt)));

  if (result.doc.visibility === "public" && result.doc.publicSlug) {
    revalidatePath(`/p/${result.doc.publicSlug}`);
  }
  await recordDocumentActivity({
    documentId: result.doc.id,
    userId: opts.userId,
    action: "trashed",
    metadata: { subtreeSize: ids.length },
  });
  logger.info("document.trash", {
    documentId: result.doc.id,
    subtreeSize: ids.length,
  });
  return result.doc;
}

/** Restore a trashed document (and descendants trashed with it). */
export async function restoreDocument(opts: {
  userId: string;
  documentId: string;
}) {
  const result = await getDocumentWithAccess(opts.userId, opts.documentId);
  if (!result) throw new Error("NOT_FOUND");
  if (!canView(result.access)) throw new Error("FORBIDDEN");
  const membership = await requireMembership(
    opts.userId,
    result.doc.workspaceId,
    "member",
  );
  void membership;
  if (!result.doc.archivedAt) return result.doc;

  const db = getDb();
  const ids = await getSubtreeIds(db, result.doc.id);
  await db
    .update(documents)
    .set({ archivedAt: null, updatedById: opts.userId })
    .where(and(inArray(documents.id, ids), isNotNull(documents.archivedAt)));

  // If the parent is still trashed (or gone), reattach at the root.
  if (result.doc.parentId) {
    const [parent] = await db
      .select({ archivedAt: documents.archivedAt })
      .from(documents)
      .where(eq(documents.id, result.doc.parentId))
      .limit(1);
    if (!parent || parent.archivedAt) {
      await db
        .update(documents)
        .set({ parentId: null })
        .where(eq(documents.id, result.doc.id));
      await recomputeBreadcrumbs(db, result.doc.id);
    }
  }

  await recordDocumentActivity({
    documentId: result.doc.id,
    userId: opts.userId,
    action: "restored",
  });
  logger.info("document.restore", { documentId: result.doc.id });
  return result.doc;
}

export async function listTrashedDocuments(
  userId: string,
  workspaceId: string,
) {
  await requireMembership(userId, workspaceId, "guest");
  const db = getDb();
  return db
    .select({
      id: documents.id,
      title: documents.title,
      icon: documents.icon,
      archivedAt: documents.archivedAt,
      updatedAt: documents.updatedAt,
      parentId: documents.parentId,
    })
    .from(documents)
    .where(
      and(
        eq(documents.workspaceId, workspaceId),
        isNotNull(documents.archivedAt),
        visibleTo(userId),
      ),
    )
    .orderBy(desc(documents.archivedAt));
}

/* -------------------------------------------------------------------------- */
/* Version history                                                             */
/* -------------------------------------------------------------------------- */

export async function listDocumentVersions(
  userId: string,
  documentId: string,
) {
  const result = await getDocumentWithAccess(userId, documentId);
  if (!result || !canView(result.access)) throw new Error("FORBIDDEN");
  const db = getDb();
  return db
    .select({
      id: documentVersions.id,
      version: documentVersions.version,
      title: documentVersions.title,
      createdAt: documentVersions.createdAt,
      createdByName: user.name,
    })
    .from(documentVersions)
    .leftJoin(user, eq(user.id, documentVersions.createdById))
    .where(eq(documentVersions.documentId, documentId))
    .orderBy(desc(documentVersions.version));
}

export async function getDocumentVersion(
  userId: string,
  documentId: string,
  versionId: string,
) {
  const result = await getDocumentWithAccess(userId, documentId);
  if (!result || !canView(result.access)) throw new Error("FORBIDDEN");
  const db = getDb();
  const [version] = await db
    .select()
    .from(documentVersions)
    .where(
      and(
        eq(documentVersions.id, versionId),
        eq(documentVersions.documentId, documentId),
      ),
    )
    .limit(1);
  return version ?? null;
}

export async function restoreDocumentVersion(opts: {
  userId: string;
  documentId: string;
  versionId: string;
}) {
  const existing = await requireEditableDocument(opts.userId, opts.documentId);
  const version = await getDocumentVersion(
    opts.userId,
    opts.documentId,
    opts.versionId,
  );
  if (!version) throw new Error("NOT_FOUND");

  const db = getDb();
  const [latest] = await db
    .select({ version: documentVersions.version })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, existing.id))
    .orderBy(desc(documentVersions.version))
    .limit(1);

  // Snapshot the current state before restoring, so nothing is lost.
  await db.insert(documentVersions).values({
    id: nanoid(),
    documentId: existing.id,
    version: (latest?.version ?? 0) + 1,
    title: existing.title,
    contentJson: existing.contentJson,
    plainTextContent: existing.plainTextContent,
    createdById: opts.userId,
  });

  const [updated] = await db
    .update(documents)
    .set({
      title: version.title,
      contentJson: version.contentJson,
      plainTextContent: version.plainTextContent,
      updatedById: opts.userId,
      updatedAt: new Date(),
    })
    .where(eq(documents.id, existing.id))
    .returning();

  await recomputeBreadcrumbs(db, existing.id);
  await recordDocumentActivity({
    documentId: existing.id,
    userId: opts.userId,
    action: "version_restored",
    metadata: { version: version.version },
  });
  logger.info("document.restore_version", {
    documentId: existing.id,
    versionId: opts.versionId,
  });
  return updated;
}

/* -------------------------------------------------------------------------- */
/* Publish                                                                     */
/* -------------------------------------------------------------------------- */

export async function publishDocument(opts: {
  userId: string;
  documentId: string;
  publish: boolean;
}) {
  const existing = await requireEditableDocument(opts.userId, opts.documentId);

  const db = getDb();
  let publicSlug = existing.publicSlug;

  if (opts.publish && !publicSlug) {
    publicSlug = `${slugify(existing.title) || "doc"}-${nanoid(10)}`;
  }

  const previousSlug = existing.publicSlug;

  const [updated] = await db
    .update(documents)
    .set({
      visibility: opts.publish ? "public" : "workspace",
      publicSlug: opts.publish ? publicSlug : existing.publicSlug,
      publishedAt: opts.publish ? new Date() : null,
      updatedById: opts.userId,
      updatedAt: new Date(),
    })
    .where(eq(documents.id, existing.id))
    .returning();

  if (previousSlug) revalidatePath(`/p/${previousSlug}`);
  if (updated.publicSlug && updated.publicSlug !== previousSlug) {
    revalidatePath(`/p/${updated.publicSlug}`);
  }

  await recordDocumentActivity({
    documentId: existing.id,
    userId: opts.userId,
    action: opts.publish ? "published" : "unpublished",
  });
  logger.info("document.publish", {
    documentId: existing.id,
    publish: opts.publish,
  });

  return updated;
}

export async function getPublicDocument(slug: string) {
  const db = getDb();
  const [row] = await db
    .select({
      id: documents.id,
      title: documents.title,
      contentJson: documents.contentJson,
      plainTextContent: documents.plainTextContent,
      coverImageUrl: documents.coverImageUrl,
      icon: documents.icon,
      publishedAt: documents.publishedAt,
      updatedAt: documents.updatedAt,
      publicSlug: documents.publicSlug,
      visibility: documents.visibility,
      creatorName: user.name,
      workspaceName: workspaces.name,
    })
    .from(documents)
    .innerJoin(user, eq(user.id, documents.createdById))
    .innerJoin(workspaces, eq(workspaces.id, documents.workspaceId))
    .where(
      and(
        eq(documents.publicSlug, slug),
        eq(documents.visibility, "public"),
        isNull(documents.archivedAt),
      ),
    )
    .limit(1);

  return row ?? null;
}

/* -------------------------------------------------------------------------- */
/* Workspaces list                                                             */
/* -------------------------------------------------------------------------- */

export async function listUserWorkspaces(userId: string) {
  const db = getDb();
  return db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      iconUrl: workspaces.iconUrl,
      isPersonal: workspaces.isPersonal,
      role: workspaceMembers.role,
    })
    .from(workspaces)
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, workspaces.id),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .orderBy(desc(workspaces.isPersonal), asc(workspaces.name));
}
