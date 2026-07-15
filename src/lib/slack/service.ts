import "server-only";
import { cache } from "react";
import { and, eq, lt } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  getDb,
  slackConnections,
  slackUserLinks,
  slackEvents,
  user,
} from "@/db";
import { getServerEnv } from "@/env/server";
import { encryptToken, decryptToken } from "./crypto";
import { logger } from "@/lib/logger";

/* ------------------------------ Connections ------------------------------ */

export type SlackConnection = {
  id: string;
  workspaceId: string;
  slackTeamId: string;
  slackTeamName: string;
  botUserId: string;
  scopes: string;
  installedById: string;
  createdAt: Date;
};

function encryptionKey(): string {
  const key = getServerEnv().SLACK_TOKEN_ENCRYPTION_KEY;
  if (!key) throw new Error("SLACK_TOKEN_ENCRYPTION_KEY is not configured");
  return key;
}

export async function saveConnection(opts: {
  workspaceId: string;
  slackTeamId: string;
  slackTeamName: string;
  botToken: string;
  botUserId: string;
  scopes: string;
  installedById: string;
}) {
  const db = getDb();
  const encrypted = encryptToken(opts.botToken, encryptionKey());
  const values = {
    workspaceId: opts.workspaceId,
    slackTeamId: opts.slackTeamId,
    slackTeamName: opts.slackTeamName,
    encryptedBotToken: encrypted,
    botUserId: opts.botUserId,
    scopes: opts.scopes,
    installedById: opts.installedById,
    updatedAt: new Date(),
  };
  await db
    .insert(slackConnections)
    .values({ id: nanoid(), ...values })
    .onConflictDoUpdate({
      target: slackConnections.workspaceId,
      set: values,
    });
  logger.info("slack.connection_saved", {
    workspaceId: opts.workspaceId,
    slackTeamId: opts.slackTeamId,
  });
}

export async function deleteConnection(workspaceId: string) {
  const db = getDb();
  await db
    .delete(slackConnections)
    .where(eq(slackConnections.workspaceId, workspaceId));
  logger.info("slack.connection_deleted", { workspaceId });
}

export const getConnectionForWorkspace = cache(async function getConnectionForWorkspace(
  workspaceId: string,
): Promise<SlackConnection | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(slackConnections)
    .where(eq(slackConnections.workspaceId, workspaceId))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    slackTeamId: row.slackTeamId,
    slackTeamName: row.slackTeamName,
    botUserId: row.botUserId,
    scopes: row.scopes,
    installedById: row.installedById,
    createdAt: row.createdAt,
  };
});

/** Decrypted bot token for a workspace connection. */
export async function getBotTokenForWorkspace(
  workspaceId: string,
): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ encrypted: slackConnections.encryptedBotToken })
    .from(slackConnections)
    .where(eq(slackConnections.workspaceId, workspaceId))
    .limit(1);
  if (!row) return null;
  return decryptToken(row.encrypted, encryptionKey());
}

/** All connections for a Slack team (a team may serve several workspaces). */
export async function getConnectionsForTeam(slackTeamId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(slackConnections)
    .where(eq(slackConnections.slackTeamId, slackTeamId));
  return rows.map((row) => ({
    connection: {
      id: row.id,
      workspaceId: row.workspaceId,
      slackTeamId: row.slackTeamId,
      slackTeamName: row.slackTeamName,
      botUserId: row.botUserId,
      scopes: row.scopes,
      installedById: row.installedById,
      createdAt: row.createdAt,
    } satisfies SlackConnection,
    botToken: () => decryptToken(row.encryptedBotToken, encryptionKey()),
  }));
}

/* ------------------------------- User links ------------------------------ */

export async function linkSlackUser(opts: {
  userId: string;
  slackTeamId: string;
  slackUserId: string;
}) {
  const db = getDb();
  // One BackBeat Notes account per Slack identity (and vice versa per team).
  await db
    .delete(slackUserLinks)
    .where(
      and(
        eq(slackUserLinks.slackTeamId, opts.slackTeamId),
        eq(slackUserLinks.slackUserId, opts.slackUserId),
      ),
    );
  await db
    .delete(slackUserLinks)
    .where(
      and(
        eq(slackUserLinks.userId, opts.userId),
        eq(slackUserLinks.slackTeamId, opts.slackTeamId),
      ),
    );
  await db.insert(slackUserLinks).values({
    id: nanoid(),
    userId: opts.userId,
    slackTeamId: opts.slackTeamId,
    slackUserId: opts.slackUserId,
  });
  logger.info("slack.user_linked", {
    userId: opts.userId,
    slackTeamId: opts.slackTeamId,
  });
}

export async function unlinkSlackUser(opts: {
  userId: string;
  slackTeamId?: string;
}) {
  const db = getDb();
  await db
    .delete(slackUserLinks)
    .where(
      opts.slackTeamId
        ? and(
            eq(slackUserLinks.userId, opts.userId),
            eq(slackUserLinks.slackTeamId, opts.slackTeamId),
          )
        : eq(slackUserLinks.userId, opts.userId),
    );
}

/** Resolve the BackBeat Notes user linked to a Slack identity. */
export async function getLinkedUser(opts: {
  slackTeamId: string;
  slackUserId: string;
}): Promise<{ userId: string; name: string; email: string } | null> {
  const db = getDb();
  const [row] = await db
    .select({ userId: slackUserLinks.userId, name: user.name, email: user.email })
    .from(slackUserLinks)
    .innerJoin(user, eq(user.id, slackUserLinks.userId))
    .where(
      and(
        eq(slackUserLinks.slackTeamId, opts.slackTeamId),
        eq(slackUserLinks.slackUserId, opts.slackUserId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getUserSlackLinks(userId: string) {
  const db = getDb();
  return db
    .select()
    .from(slackUserLinks)
    .where(eq(slackUserLinks.userId, userId));
}

/* ------------------------------ Idempotency ------------------------------ */

/**
 * Returns true when this event key has not been processed before.
 * Slack redelivers events on slow acks — inserting on conflict-do-nothing
 * makes processing exactly-once per key.
 */
export async function claimEvent(eventKey: string): Promise<boolean> {
  const db = getDb();
  const inserted = await db
    .insert(slackEvents)
    .values({ eventKey })
    .onConflictDoNothing()
    .returning({ eventKey: slackEvents.eventKey });
  return inserted.length > 0;
}

/** Prune old event keys (called from cron). */
export async function pruneSlackEvents(olderThanHours = 24) {
  const db = getDb();
  const cutoff = new Date(Date.now() - olderThanHours * 3600 * 1000);
  const deleted = await db
    .delete(slackEvents)
    .where(lt(slackEvents.receivedAt, cutoff))
    .returning({ eventKey: slackEvents.eventKey });
  return deleted.length;
}
