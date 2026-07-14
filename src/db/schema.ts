import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  customType,
  vector,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

/** tsvector custom type for full-text search */
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

export const workspaceRoleEnum = pgEnum("workspace_role", [
  "owner",
  "admin",
  "member",
  "guest",
]);

export const invitationStatusEnum = pgEnum("invitation_status", [
  "pending",
  "accepted",
  "revoked",
  "expired",
]);

export const fileAccessEnum = pgEnum("file_access", [
  "private",
  "workspace",
  "public",
]);

export const documentVisibilityEnum = pgEnum("document_visibility", [
  "private",
  "workspace",
  "public",
]);

export const documentTypeEnum = pgEnum("document_type", ["doc", "wiki"]);

/**
 * Per-document access levels for direct shares (Notion-style):
 * - full_access: edit + manage sharing
 * - edit: edit content
 * - view: read-only
 */
export const documentPermissionLevelEnum = pgEnum("document_permission_level", [
  "full_access",
  "edit",
  "view",
]);

export const documentActivityActionEnum = pgEnum("document_activity_action", [
  "created",
  "edited",
  "renamed",
  "moved",
  "trashed",
  "restored",
  "published",
  "unpublished",
  "version_restored",
  "locked",
  "unlocked",
  "shared",
  "unshared",
  "general_access_changed",
]);

/* -------------------------------------------------------------------------- */
/* Better Auth core tables                                                     */
/* -------------------------------------------------------------------------- */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  /** Platform user type: admins can create workspaces + manage locked wikis. */
  role: text("role", { enum: ["admin", "developer"] })
    .notNull()
    .default("developer"),
  /** Opt-out toggle for document-activity email notifications. */
  emailNotifications: boolean("email_notifications").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

/* -------------------------------------------------------------------------- */
/* Workspaces                                                                  */
/* -------------------------------------------------------------------------- */

export const workspaces = pgTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    iconUrl: text("icon_url"),
    iconBlobPathname: text("icon_blob_pathname"),
    /**
     * Personal notebooks are single-member workspaces provisioned per user.
     * They can never be shared: invitations and membership changes are
     * rejected server-side for personal workspaces.
     */
    isPersonal: boolean("is_personal").notNull().default(false),
    createdById: text("created_by_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("workspaces_slug_uidx").on(t.slug),
    uniqueIndex("workspaces_personal_owner_uidx")
      .on(t.createdById)
      .where(sql`${t.isPersonal}`),
  ],
);

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: workspaceRoleEnum("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("workspace_members_ws_user_uidx").on(t.workspaceId, t.userId),
    index("workspace_members_user_idx").on(t.userId),
  ],
);

export const workspaceInvitations = pgTable(
  "workspace_invitations",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: workspaceRoleEnum("role").notNull().default("member"),
    token: text("token").notNull(),
    status: invitationStatusEnum("status").notNull().default("pending"),
    invitedById: text("invited_by_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    /** When the invite email was last (re)sent. */
    lastSentAt: timestamp("last_sent_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("workspace_invitations_token_uidx").on(t.token),
    index("workspace_invitations_email_idx").on(t.email),
    index("workspace_invitations_expires_idx").on(t.expiresAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* Documents                                                                   */
/* -------------------------------------------------------------------------- */

export const documents = pgTable(
  "documents",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    parentId: text("parent_id"),
    title: text("title").notNull().default("Untitled"),
    /** Stable public slug — used for /p/[slug] routes */
    publicSlug: text("public_slug"),
    visibility: documentVisibilityEnum("visibility")
      .notNull()
      .default("workspace"),
    /** Document type — wikis can be locked to admin-only editing. */
    docType: documentTypeEnum("doc_type").notNull().default("doc"),
    /** When set, the wiki is locked: only admins can edit or unlock. */
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedById: text("locked_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    /** TipTap JSON document */
    contentJson: jsonb("content_json").$type<Record<string, unknown>>().notNull().default({}),
    /** Normalized plain text for search */
    plainTextContent: text("plain_text_content").notNull().default(""),
    /** Breadcrumb path string for search (e.g. "Engineering / API / Auth") */
    breadcrumbPath: text("breadcrumb_path").notNull().default(""),
    coverImageUrl: text("cover_image_url"),
    coverImageBlobPathname: text("cover_image_blob_pathname"),
    icon: text("icon"),
    createdById: text("created_by_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    updatedById: text("updated_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Weighted FTS vector — maintained via trigger / application update */
    searchVector: tsvector("search_vector"),
  },
  (t) => [
    index("documents_workspace_idx").on(t.workspaceId),
    index("documents_parent_idx").on(t.parentId),
    uniqueIndex("documents_public_slug_uidx").on(t.publicSlug),
    index("documents_updated_idx").on(t.updatedAt),
    index("documents_title_trgm_idx").using(
      "gin",
      sql`${t.title} gin_trgm_ops`,
    ),
    index("documents_search_vector_idx").using("gin", t.searchVector),
  ],
);

/**
 * Searchable TipTap text blocks. Text/ordering is synchronized on document
 * writes; embeddings are filled asynchronously when OpenAI is configured.
 */
export const documentSearchBlocks = pgTable(
  "document_search_blocks",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    blockId: text("block_id").notNull(),
    blockType: text("block_type").notNull(),
    position: integer("position").notNull(),
    textContent: text("text_content").notNull(),
    inputHash: text("input_hash").notNull(),
    embedding: vector("embedding", { dimensions: 512 }),
    embeddedAt: timestamp("embedded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("document_search_blocks_doc_block_uidx").on(
      t.documentId,
      t.blockId,
    ),
    index("document_search_blocks_doc_position_idx").on(
      t.documentId,
      t.position,
    ),
    index("document_search_blocks_embedding_hnsw_idx")
      .using("hnsw", t.embedding.op("vector_cosine_ops"))
      .where(sql`${t.embedding} IS NOT NULL`),
  ],
);

/**
 * Direct per-document shares (Notion-style "Share" popover).
 * Grants access to a single page, independent of workspace membership —
 * this is how pages are shared with people outside the workspace and how
 * "Only people invited" pages are opened up to specific teammates.
 */
export const documentPermissions = pgTable(
  "document_permissions",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    level: documentPermissionLevelEnum("level").notNull().default("view"),
    invitedById: text("invited_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("document_permissions_doc_user_uidx").on(t.documentId, t.userId),
    index("document_permissions_user_idx").on(t.userId),
  ],
);

/**
 * Pending document shares for emails without an account yet.
 * Accepting the emailed link (after sign-up) converts the invitation into a
 * document_permissions row.
 */
export const documentInvitations = pgTable(
  "document_invitations",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    level: documentPermissionLevelEnum("level").notNull().default("view"),
    token: text("token").notNull(),
    status: invitationStatusEnum("status").notNull().default("pending"),
    invitedById: text("invited_by_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    /** When the invite email was last (re)sent. */
    lastSentAt: timestamp("last_sent_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("document_invitations_token_uidx").on(t.token),
    index("document_invitations_email_idx").on(t.email),
    index("document_invitations_doc_idx").on(t.documentId),
    index("document_invitations_expires_idx").on(t.expiresAt),
  ],
);

/**
 * Per-document audit log: who did what, when.
 * `edited` rows are coalesced per user within a 15-minute window so the log
 * stays readable under constant autosave traffic.
 */
export const documentActivity = pgTable(
  "document_activity",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    action: documentActivityActionEnum("action").notNull(),
    /** Action context, e.g. { from, to } for renames, charDelta for edits. */
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Coalescing window end for `edited` rows. */
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("document_activity_doc_created_idx").on(t.documentId, t.updatedAt),
    index("document_activity_user_idx").on(t.userId),
  ],
);

/** Throttle log for outbound notification emails (one row per send). */
export const notificationLog = pgTable(
  "notification_log",
  {
    id: text("id").primaryKey(),
    recipientId: text("recipient_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    documentId: text("document_id").references(() => documents.id, {
      onDelete: "cascade",
    }),
    type: text("type").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("notification_log_recipient_doc_idx").on(
      t.recipientId,
      t.documentId,
      t.type,
      t.sentAt,
    ),
  ],
);

export const documentVersions = pgTable(
  "document_versions",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    contentJson: jsonb("content_json").$type<Record<string, unknown>>().notNull(),
    plainTextContent: text("plain_text_content").notNull().default(""),
    createdById: text("created_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("document_versions_doc_ver_uidx").on(t.documentId, t.version),
    index("document_versions_created_idx").on(t.createdAt),
  ],
);

export const favorites = pgTable(
  "favorites",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("favorites_user_doc_uidx").on(t.userId, t.documentId),
    index("favorites_user_idx").on(t.userId),
  ],
);

export const recentlyViewed = pgTable(
  "recently_viewed",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    viewedAt: timestamp("viewed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("recently_viewed_user_doc_uidx").on(t.userId, t.documentId),
    index("recently_viewed_user_viewed_idx").on(t.userId, t.viewedAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* Files (Vercel Blob metadata)                                                */
/* -------------------------------------------------------------------------- */

export const files = pgTable(
  "files",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    uploadedById: text("uploaded_by_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    documentId: text("document_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    blobUrl: text("blob_url").notNull(),
    blobPathname: text("blob_pathname").notNull(),
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    fileSize: integer("file_size").notNull(),
    access: fileAccessEnum("access").notNull().default("workspace"),
    /** Soft-delete; cron / explicit purge removes Blob when unreferenced */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("files_workspace_idx").on(t.workspaceId),
    index("files_document_idx").on(t.documentId),
    uniqueIndex("files_blob_pathname_uidx").on(t.blobPathname),
    index("files_deleted_idx").on(t.deletedAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* Slack integration                                                           */
/* -------------------------------------------------------------------------- */

/**
 * One Slack team connection per Docloom workspace, installed by an admin.
 * The bot token is encrypted at rest (AES-256-GCM, see src/lib/slack/crypto).
 */
export const slackConnections = pgTable(
  "slack_connections",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    slackTeamId: text("slack_team_id").notNull(),
    slackTeamName: text("slack_team_name").notNull(),
    /** AES-256-GCM encrypted bot token (iv:tag:ciphertext, base64). */
    encryptedBotToken: text("encrypted_bot_token").notNull(),
    botUserId: text("bot_user_id").notNull(),
    scopes: text("scopes").notNull().default(""),
    installedById: text("installed_by_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("slack_connections_workspace_uidx").on(t.workspaceId),
    index("slack_connections_team_idx").on(t.slackTeamId),
  ],
);

/** Links a Docloom user to their Slack identity in a specific Slack team. */
export const slackUserLinks = pgTable(
  "slack_user_links",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    slackTeamId: text("slack_team_id").notNull(),
    slackUserId: text("slack_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("slack_user_links_team_slack_user_uidx").on(
      t.slackTeamId,
      t.slackUserId,
    ),
    uniqueIndex("slack_user_links_user_team_uidx").on(t.userId, t.slackTeamId),
  ],
);

/** Idempotency guard for Slack event redelivery (pruned by cron). */
export const slackEvents = pgTable(
  "slack_events",
  {
    eventKey: text("event_key").primaryKey(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("slack_events_received_idx").on(t.receivedAt)],
);

/* -------------------------------------------------------------------------- */
/* Relations                                                                   */
/* -------------------------------------------------------------------------- */

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  memberships: many(workspaceMembers),
}));

export const workspaceRelations = relations(workspaces, ({ many, one }) => ({
  members: many(workspaceMembers),
  documents: many(documents),
  invitations: many(workspaceInvitations),
  createdBy: one(user, {
    fields: [workspaces.createdById],
    references: [user.id],
  }),
}));

export const documentRelations = relations(documents, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [documents.workspaceId],
    references: [workspaces.id],
  }),
  createdBy: one(user, {
    fields: [documents.createdById],
    references: [user.id],
  }),
  versions: many(documentVersions),
  files: many(files),
  searchBlocks: many(documentSearchBlocks),
}));

export const documentSearchBlockRelations = relations(
  documentSearchBlocks,
  ({ one }) => ({
    document: one(documents, {
      fields: [documentSearchBlocks.documentId],
      references: [documents.id],
    }),
  }),
);

export type User = typeof user.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type DocumentSearchBlock = typeof documentSearchBlocks.$inferSelect;
export type FileRecord = typeof files.$inferSelect;
export type WorkspaceInvitation = typeof workspaceInvitations.$inferSelect;
export type DocumentPermission = typeof documentPermissions.$inferSelect;
export type DocumentInvitation = typeof documentInvitations.$inferSelect;
