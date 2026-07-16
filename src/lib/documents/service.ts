import "server-only";
import { cache } from "react";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  sql,
} from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  cacheLife,
  cacheTag,
  revalidatePath,
  revalidateTag,
} from "next/cache";
import { after } from "next/server";
import {
  getDb,
  documents,
  documentVersions,
  documentPermissions,
  favorites,
  recentlyViewed,
  workspaces,
  workspaceMembers,
  user,
  type Document,
  type Database,
} from "@/db";
import {
  requireMembership,
  roleAtLeast,
  type WorkspaceRole,
} from "@/lib/permissions";
import {
  computeDocumentAccess,
  canManageWikiLock,
  canEdit,
  canView,
  type DocumentAccess,
  type DocumentPermissionLevel,
  type PlatformRole,
} from "./access";
import { recordDocumentActivity } from "./activity";
import { shouldCreateVersion } from "./versioning";
import { extractPlainText } from "./plain-text";
import { normalizeDocumentBlocks } from "./blocks";
import { slugify } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { measureServerOperation } from "@/lib/performance";

const PUBLIC_DOCUMENTS_TAG = "public-documents";

function publicDocumentTag(slug: string) {
  return `public-document:${slug}`;
}

function invalidatePublicDocument(slug: string | null | undefined) {
  if (slug) revalidateTag(publicDocumentTag(slug), { expire: 0 });
}

async function syncDocumentSearchAfterWrite(doc: {
  id: string;
  title: string;
  contentJson: Record<string, unknown>;
  revision: number;
}) {
  const { syncDocumentSearchIndexBestEffort } = await import(
    "@/lib/search/document-blocks"
  );
  const result = await syncDocumentSearchIndexBestEffort({
    documentId: doc.id,
    expectedRevision: doc.revision,
    title: doc.title,
    contentJson: doc.contentJson,
  });
  if (result.status !== "synced") return;

  // Only external AI work is deferred. The relational paragraph index is
  // already consistent (or explicitly degraded) when the mutation returns.
  after(async () => {
    try {
      const { refreshDocumentBlockEmbeddings } = await import(
        "@/lib/search/document-blocks"
      );
      await refreshDocumentBlockEmbeddings(doc.id);
    } catch (error) {
      logger.error("search.document_embeddings_refresh_failed", {
        documentId: doc.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Access                                                                      */
/* -------------------------------------------------------------------------- */

export type DocumentWithAccess = {
  doc: Document;
  access: DocumentAccess;
  /** Requesting user's platform role (admin | developer). */
  platformRole: PlatformRole;
  /** Membership resolved by the same access query (null for direct shares). */
  membershipRole: WorkspaceRole | null;
};

/** The user's direct share level on a document, if any. */
export async function getDirectPermission(
  userId: string,
  documentId: string,
): Promise<DocumentPermissionLevel | null> {
  const db = getDb();
  const [row] = await db
    .select({ level: documentPermissions.level })
    .from(documentPermissions)
    .where(
      and(
        eq(documentPermissions.userId, userId),
        eq(documentPermissions.documentId, documentId),
      ),
    )
    .limit(1);
  return row?.level ?? null;
}

/**
 * Load a document and resolve the caller's access level.
 * Returns null when the document does not exist. Callers decide how to
 * render `access === "none"` (e.g. the request-access screen).
 */
export const getDocumentWithAccess = cache(async function getDocumentWithAccess(
  userId: string,
  documentId: string,
): Promise<DocumentWithAccess | null> {
  const db = getDb();
  const [row] = await measureServerOperation(
    "document.access",
    () =>
      db
        .select({
          doc: documents,
          membershipRole: workspaceMembers.role,
          platformRole: user.role,
          directPermission: documentPermissions.level,
        })
        .from(documents)
        .leftJoin(
          workspaceMembers,
          and(
            eq(workspaceMembers.workspaceId, documents.workspaceId),
            eq(workspaceMembers.userId, userId),
          ),
        )
        .leftJoin(
          documentPermissions,
          and(
            eq(documentPermissions.documentId, documents.id),
            eq(documentPermissions.userId, userId),
          ),
        )
        .leftJoin(user, eq(user.id, userId))
        .where(eq(documents.id, documentId))
        .limit(1),
    { documentId },
  );
  if (!row) return null;

  const { doc } = row;
  const platformRole: PlatformRole =
    row.platformRole === "admin" ? "admin" : "developer";
  const access = computeDocumentAccess({
    visibility: doc.visibility,
    isCreator: doc.createdById === userId,
    membershipRole: row.membershipRole,
    directPermission: row.directPermission,
    archived: doc.archivedAt !== null,
    docType: doc.docType,
    locked: doc.lockedAt !== null,
    platformRole,
  });
  return {
    doc,
    access,
    platformRole,
    membershipRole: row.membershipRole,
  };
});

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

/**
 * SQL fragment: exclude "Only people invited" (private) docs unless the user
 * created them or holds a direct share. Mirror of computeDocumentAccess —
 * keep in sync.
 */
function visibleTo(userId: string) {
  return sql`(
    ${documents.visibility} <> 'private'
    OR ${documents.createdById} = ${userId}
    OR EXISTS (
      SELECT 1 FROM document_permissions dp
      WHERE dp.document_id = ${documents.id} AND dp.user_id = ${userId}
    )
  )`;
}

/* -------------------------------------------------------------------------- */
/* Listing                                                                     */
/* -------------------------------------------------------------------------- */

export const MAX_WORKSPACE_DOCUMENTS = 500;
const MAX_SIDEBAR_FAVORITES = 100;
const MAX_TRASH_DOCUMENTS = 200;

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
      publishedAt: documents.publishedAt,
      icon: documents.icon,
      docType: documents.docType,
      lockedAt: documents.lockedAt,
      updatedAt: documents.updatedAt,
      createdById: documents.createdById,
      updatedByName: user.name,
    })
    .from(documents)
    .leftJoin(
      user,
      eq(
        user.id,
        sql`coalesce(${documents.updatedById}, ${documents.createdById})`,
      ),
    )
    .where(
      and(
        eq(documents.workspaceId, workspaceId),
        isNull(documents.archivedAt),
        visibleTo(userId),
      ),
    )
    .orderBy(asc(documents.title))
    .limit(MAX_WORKSPACE_DOCUMENTS);
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
      updatedByName: row.updatedByName,
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

/**
 * Load every authorized workspace tree in one SQL request. The workspace IDs
 * come from the caller's workspace summary, but the membership join keeps this
 * helper safe if it is reused with untrusted IDs.
 */
export async function listWorkspaceDocumentTrees(
  userId: string,
  workspaceIds: string[],
): Promise<Array<{ workspaceId: string; nodes: DocumentTreeNode[] }>> {
  if (workspaceIds.length === 0) return [];
  const db = getDb();
  const rows = await measureServerOperation(
    "sidebar.document_trees",
    () =>
      db
        .select({
          workspaceId: documents.workspaceId,
          id: documents.id,
          title: documents.title,
          parentId: documents.parentId,
          visibility: documents.visibility,
          icon: documents.icon,
          docType: documents.docType,
          lockedAt: documents.lockedAt,
          updatedAt: documents.updatedAt,
          createdById: documents.createdById,
          updatedByName: user.name,
        })
        .from(documents)
        .innerJoin(
          workspaceMembers,
          and(
            eq(workspaceMembers.workspaceId, documents.workspaceId),
            eq(workspaceMembers.userId, userId),
          ),
        )
        .leftJoin(
          user,
          eq(
            user.id,
            sql`coalesce(${documents.updatedById}, ${documents.createdById})`,
          ),
        )
        .where(
          and(
            inArray(documents.workspaceId, workspaceIds),
            isNull(documents.archivedAt),
            visibleTo(userId),
          ),
        )
        .orderBy(asc(documents.workspaceId), asc(documents.title))
        .limit(MAX_WORKSPACE_DOCUMENTS * workspaceIds.length),
    { workspaceCount: workspaceIds.length },
  );

  const byWorkspace = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byWorkspace.get(row.workspaceId) ?? [];
    list.push(row);
    byWorkspace.set(row.workspaceId, list);
  }

  return workspaceIds.map((workspaceId) => {
    const nodes = new Map<string, DocumentTreeNode>();
    for (const row of byWorkspace.get(workspaceId) ?? []) {
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
        updatedByName: row.updatedByName,
        children: [],
      });
    }
    const roots: DocumentTreeNode[] = [];
    for (const node of nodes.values()) {
      const parent = node.parentId ? nodes.get(node.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return { workspaceId, nodes: roots };
  });
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
  const now = new Date();
  const updateBefore = new Date(now.getTime() - 5 * 60 * 1000);
  await db
    .insert(recentlyViewed)
    .values({ id: nanoid(), userId, documentId, viewedAt: now })
    .onConflictDoUpdate({
      target: [recentlyViewed.userId, recentlyViewed.documentId],
      set: { viewedAt: now },
      setWhere: lt(recentlyViewed.viewedAt, updateBefore),
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
    .orderBy(desc(favorites.createdAt))
    .limit(MAX_SIDEBAR_FAVORITES);
}

/** Favorites across every workspace the user is still a member of. */
export async function listAllFavoriteDocuments(userId: string) {
  const db = getDb();
  return db
    .select({
      id: documents.id,
      title: documents.title,
      icon: documents.icon,
      workspaceId: documents.workspaceId,
    })
    .from(favorites)
    .innerJoin(documents, eq(documents.id, favorites.documentId))
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, documents.workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .where(
      and(
        eq(favorites.userId, userId),
        isNull(documents.archivedAt),
        visibleTo(userId),
      ),
    )
    .orderBy(desc(favorites.createdAt))
    .limit(MAX_SIDEBAR_FAVORITES);
}

/** Sidebar favorites and IDs from one query instead of two identical reads. */
export async function listSidebarFavorites(userId: string) {
  const documents = await listAllFavoriteDocuments(userId);
  return {
    documents,
    ids: documents.map((document) => document.id),
  };
}

/** Every favorited document id for the user, across all workspaces. */
export async function listFavoriteDocumentIds(
  userId: string,
): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ documentId: favorites.documentId })
    .from(favorites)
    .where(eq(favorites.userId, userId));
  return rows.map((row) => row.documentId);
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

async function resolveParentAndBreadcrumb(opts: {
  db: Database;
  workspaceId: string;
  requestedParentId?: string | null;
  title: string;
}) {
  if (!opts.requestedParentId) {
    return { parentId: null, breadcrumbPath: opts.title };
  }

  const [parent] = await opts.db
    .select({
      workspaceId: documents.workspaceId,
      title: documents.title,
      breadcrumbPath: documents.breadcrumbPath,
    })
    .from(documents)
    .where(eq(documents.id, opts.requestedParentId))
    .limit(1);

  if (!parent || parent.workspaceId !== opts.workspaceId) {
    return { parentId: null, breadcrumbPath: opts.title };
  }
  return {
    parentId: opts.requestedParentId,
    breadcrumbPath: `${parent.breadcrumbPath || parent.title} / ${opts.title}`,
  };
}

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
  const initialContent = normalizeDocumentBlocks({
    type: "doc",
    content: [{ type: "paragraph" }],
  }).contentJson;
  const { parentId, breadcrumbPath } = await resolveParentAndBreadcrumb({
    db,
    workspaceId: opts.workspaceId,
    requestedParentId: opts.parentId,
    title,
  });

  const [doc] = await db
    .insert(documents)
    .values({
      id,
      workspaceId: opts.workspaceId,
      parentId,
      title,
      breadcrumbPath,
      docType: opts.docType ?? "doc",
      contentJson: initialContent,
      plainTextContent: "",
      createdById: opts.userId,
      updatedById: opts.userId,
    })
    .returning();

  await syncDocumentSearchAfterWrite(doc);
  await recordDocumentActivity({
    documentId: doc.id,
    userId: opts.userId,
    action: "created",
    metadata: { docType: doc.docType },
  });

  return doc;
}

/**
 * Create a root-level document with prefilled TipTap content (import flows).
 * Always lands at workspace root (`parentId: null`) for the Google Docs importer.
 */
export async function importDocument(opts: {
  userId: string;
  workspaceId: string;
  title: string;
  contentJson: Record<string, unknown>;
  activityMetadata?: Record<string, unknown>;
}) {
  await requireMembership(opts.userId, opts.workspaceId, "member");
  const db = getDb();
  const id = nanoid();
  const title = opts.title?.trim() || "Untitled";
  const normalizedContent = normalizeDocumentBlocks(opts.contentJson).contentJson;
  const plainTextContent = extractPlainText(normalizedContent);

  const [doc] = await db
    .insert(documents)
    .values({
      id,
      workspaceId: opts.workspaceId,
      parentId: null,
      title,
      breadcrumbPath: title,
      docType: "doc",
      contentJson: normalizedContent,
      plainTextContent,
      createdById: opts.userId,
      updatedById: opts.userId,
    })
    .returning();

  await syncDocumentSearchAfterWrite(doc);
  await recordDocumentActivity({
    documentId: doc.id,
    userId: opts.userId,
    action: "created",
    metadata: {
      docType: doc.docType,
      ...(opts.activityMetadata ?? {}),
    },
  });

  return doc;
}

/** Copy a document (content, icon, type) next to the original. */
export async function duplicateDocument(opts: {
  userId: string;
  documentId: string;
}) {
  const source = await getDocumentForUser(opts.userId, opts.documentId);
  if (!source) throw new Error("NOT_FOUND");
  await requireMembership(opts.userId, source.workspaceId, "member");
  const db = getDb();
  const id = nanoid();
  const title = `${source.title} (copy)`;
  const copiedContent = normalizeDocumentBlocks(source.contentJson, {
    regenerateIds: true,
  }).contentJson;
  const { parentId, breadcrumbPath } = await resolveParentAndBreadcrumb({
    db,
    workspaceId: source.workspaceId,
    requestedParentId: source.parentId,
    title,
  });
  const [copy] = await db
    .insert(documents)
    .values({
      id,
      workspaceId: source.workspaceId,
      parentId,
      title,
      breadcrumbPath,
      docType: source.docType,
      contentJson: copiedContent,
      plainTextContent: extractPlainText(copiedContent),
      icon: source.icon,
      createdById: opts.userId,
      updatedById: opts.userId,
    })
    .returning();
  await syncDocumentSearchAfterWrite(copy);
  await recordDocumentActivity({
    documentId: copy.id,
    userId: opts.userId,
    action: "created",
    metadata: { docType: copy.docType, duplicatedFrom: source.id },
  });
  revalidatePath(`/app/${source.workspaceId}`, "layout");
  return copy;
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
  expectedRevision: number;
}) {
  const existing = await requireEditableDocument(opts.userId, opts.documentId);
  if (existing.revision !== opts.expectedRevision) {
    throw new Error("EDIT_CONFLICT");
  }

  const title = opts.title?.trim() || existing.title;
  const normalizedContent = normalizeDocumentBlocks(opts.contentJson).contentJson;
  const plainTextContent = extractPlainText(normalizedContent);
  const db = getDb();

  // Version history is valuable, but a snapshot failure must never discard
  // the user's current edit.
  try {
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
  } catch (error) {
    logger.error("document.version_snapshot_failed", {
      documentId: existing.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const [updated] = await db
    .update(documents)
    .set({
      title,
      contentJson: normalizedContent,
      plainTextContent,
      updatedById: opts.userId,
      updatedAt: new Date(),
      revision: sql`${documents.revision} + 1`,
    })
    .where(
      and(
        eq(documents.id, existing.id),
        eq(documents.revision, opts.expectedRevision),
      ),
    )
    .returning();
  if (!updated) throw new Error("EDIT_CONFLICT");

  await syncDocumentSearchAfterWrite(updated);
  if (title !== existing.title) {
    await recomputeBreadcrumbs(db, existing.id);
    // A renamed page can be embedded as a sub-page in any published page.
    revalidateTag(PUBLIC_DOCUMENTS_TAG, { expire: 0 });
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

  if (existing.publishedAt && existing.publicSlug) {
    invalidatePublicDocument(existing.publicSlug);
    revalidatePath(`/p/${existing.publicSlug}`);
  }

  // Notify participants after the response is sent (throttled inside).
  after(async () => {
    try {
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
    } catch (error) {
      logger.error("document.edit_notification_failed", {
        documentId: updated.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
    .set({
      title,
      updatedById: opts.userId,
      updatedAt: new Date(),
      revision: sql`${documents.revision} + 1`,
    })
    .where(eq(documents.id, existing.id))
    .returning();
  await syncDocumentSearchAfterWrite(updated);
  await recomputeBreadcrumbs(db, existing.id);
  await recordDocumentActivity({
    documentId: existing.id,
    userId: opts.userId,
    action: "renamed",
    metadata: { from: existing.title, to: title },
  });
  revalidateTag(PUBLIC_DOCUMENTS_TAG, { expire: 0 });
  invalidatePublicDocument(existing.publicSlug);
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

  if (
    !canManageWikiLock({
      membershipRole: result.membershipRole,
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
  await db.execute(sql`
    WITH RECURSIVE ancestors AS (
      SELECT
        id,
        parent_id,
        title,
        title::text AS path,
        ARRAY[id]::text[] AS visited,
        0 AS depth
      FROM documents
      WHERE id = ${rootId}

      UNION ALL

      SELECT
        parent.id,
        parent.parent_id,
        parent.title,
        (parent.title || ' / ' || child.path)::text AS path,
        child.visited || parent.id,
        child.depth + 1
      FROM documents parent
      INNER JOIN ancestors child ON parent.id = child.parent_id
      WHERE child.depth < 100
        AND NOT parent.id = ANY(child.visited)
    ),
    root_path AS (
      SELECT path
      FROM ancestors
      ORDER BY depth DESC
      LIMIT 1
    ),
    subtree AS (
      SELECT
        root.id,
        root_path.path,
        ARRAY[root.id]::text[] AS visited,
        0 AS depth
      FROM documents root
      CROSS JOIN root_path
      WHERE root.id = ${rootId}

      UNION ALL

      SELECT
        child.id,
        (parent.path || ' / ' || child.title)::text AS path,
        parent.visited || child.id,
        parent.depth + 1
      FROM documents child
      INNER JOIN subtree parent ON child.parent_id = parent.id
      WHERE parent.depth < 100
        AND NOT child.id = ANY(parent.visited)
    )
    UPDATE documents target
    SET breadcrumb_path = subtree.path
    FROM subtree
    WHERE target.id = subtree.id
      AND target.breadcrumb_path IS DISTINCT FROM subtree.path
  `);
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
    const hierarchy = await db.execute(sql`
      WITH RECURSIVE ancestors AS (
        SELECT
          id,
          parent_id,
          workspace_id,
          archived_at,
          ARRAY[id]::text[] AS visited,
          0 AS depth
        FROM documents
        WHERE id = ${opts.newParentId}

        UNION ALL

        SELECT
          parent.id,
          parent.parent_id,
          parent.workspace_id,
          parent.archived_at,
          child.visited || parent.id,
          child.depth + 1
        FROM documents parent
        INNER JOIN ancestors child ON parent.id = child.parent_id
        WHERE child.depth < 100
          AND NOT parent.id = ANY(child.visited)
      )
      SELECT
        root.workspace_id,
        root.archived_at,
        EXISTS (
          SELECT 1 FROM ancestors WHERE id = ${existing.id}
        ) AS creates_cycle
      FROM ancestors root
      WHERE root.id = ${opts.newParentId}
      LIMIT 1
    `);
    const [parent] = hierarchy.rows as Array<{
      workspace_id: string;
      archived_at: Date | null;
      creates_cycle: boolean;
    }>;
    if (
      !parent ||
      parent.workspace_id !== existing.workspaceId ||
      parent.archived_at ||
      parent.creates_cycle
    ) {
      throw new Error("INVALID_PARENT");
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
  if (!canEdit(result.access)) throw new Error("FORBIDDEN");

  const db = getDb();
  const ids = await getSubtreeIds(db, result.doc.id);
  await db
    .update(documents)
    .set({ archivedAt: new Date(), updatedById: opts.userId })
    .where(and(inArray(documents.id, ids), isNull(documents.archivedAt)));

  if (result.doc.publishedAt && result.doc.publicSlug) {
    invalidatePublicDocument(result.doc.publicSlug);
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
  if (
    !result.membershipRole ||
    !roleAtLeast(result.membershipRole, "member")
  ) {
    throw new Error("FORBIDDEN");
  }
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
  if (result.doc.publishedAt) {
    invalidatePublicDocument(result.doc.publicSlug);
  }
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
    .orderBy(desc(documents.archivedAt))
    .limit(MAX_TRASH_DOCUMENTS);
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

  const restoredContent = normalizeDocumentBlocks(
    version.contentJson,
  ).contentJson;
  const [updated] = await db
    .update(documents)
    .set({
      title: version.title,
      contentJson: restoredContent,
      plainTextContent: extractPlainText(restoredContent),
      updatedById: opts.userId,
      updatedAt: new Date(),
      revision: sql`${documents.revision} + 1`,
    })
    .where(eq(documents.id, existing.id))
    .returning();

  await syncDocumentSearchAfterWrite(updated);
  await recomputeBreadcrumbs(db, existing.id);
  await recordDocumentActivity({
    documentId: existing.id,
    userId: opts.userId,
    action: "version_restored",
    metadata: { version: version.version },
  });
  if (existing.publishedAt) {
    revalidateTag(PUBLIC_DOCUMENTS_TAG, { expire: 0 });
    invalidatePublicDocument(existing.publicSlug);
  }
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

  // Publishing is orthogonal to in-app General access (visibility):
  // a page can be "Only people invited" and still be published to the web.
  const [updated] = await db
    .update(documents)
    .set({
      publicSlug: opts.publish ? publicSlug : existing.publicSlug,
      publishedAt: opts.publish ? new Date() : null,
      updatedById: opts.userId,
      updatedAt: new Date(),
    })
    .where(eq(documents.id, existing.id))
    .returning();

  if (previousSlug) {
    invalidatePublicDocument(previousSlug);
    revalidatePath(`/p/${previousSlug}`);
  }
  if (updated.publicSlug && updated.publicSlug !== previousSlug) {
    invalidatePublicDocument(updated.publicSlug);
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
  "use cache";
  cacheLife("max");
  cacheTag(PUBLIC_DOCUMENTS_TAG, publicDocumentTag(slug));

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
        isNotNull(documents.publishedAt),
        isNull(documents.archivedAt),
      ),
    )
    .limit(1);

  return row ?? null;
}

/* -------------------------------------------------------------------------- */
/* Shared with me                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Pages shared directly with the user (document_permissions) that are not
 * already visible in their sidebar trees — i.e. pages in workspaces they are
 * not a member of, plus "Only people invited" pages of other members.
 * Powers the Notion-style "Shared" sidebar section.
 */
export async function listSharedWithMe(userId: string) {
  const db = getDb();
  return db
    .select({
      id: documents.id,
      title: documents.title,
      icon: documents.icon,
      workspaceId: documents.workspaceId,
      level: documentPermissions.level,
      updatedAt: documents.updatedAt,
    })
    .from(documentPermissions)
    .innerJoin(documents, eq(documents.id, documentPermissions.documentId))
    .leftJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, documents.workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .where(
      and(
        eq(documentPermissions.userId, userId),
        isNull(documents.archivedAt),
        // Already in the tree when the user is a member and the page is
        // workspace-visible — avoid duplicating those rows here.
        sql`NOT (${workspaceMembers.id} IS NOT NULL AND ${documents.visibility} <> 'private')`,
      ),
    )
    .orderBy(desc(documentPermissions.createdAt));
}

/* -------------------------------------------------------------------------- */
/* Workspaces list                                                             */
/* -------------------------------------------------------------------------- */

export const listUserWorkspaces = cache(async function listUserWorkspaces(
  userId: string,
) {
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
});
