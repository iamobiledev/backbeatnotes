import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });
import { hashPassword } from "better-auth/crypto";
import { nanoid } from "nanoid";
import * as schema from "../src/db/schema";
import { createDatabase } from "../src/db/create-db";
import { brand } from "../src/config/brand";

/**
 * Local development seed.
 * Usage: pnpm db:seed
 *
 * Creates a verified demo user, workspace, and sample documents.
 * Does not run in production unless SEED_ALLOW_PRODUCTION=true.
 */
async function main() {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.SEED_ALLOW_PRODUCTION !== "true"
  ) {
    throw new Error(
      "Refusing to seed production. Set SEED_ALLOW_PRODUCTION=true to override.",
    );
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");

  const db = createDatabase(url);

  const email = process.env.SEED_USER_EMAIL ?? "demo@docloom.local";
  const password = process.env.SEED_USER_PASSWORD ?? "DocloomDemo123!";
  const name = process.env.SEED_USER_NAME ?? "Demo User";

  const existing = await db.query.user.findFirst({
    where: (u, { eq }) => eq(u.email, email),
  });

  let userId = existing?.id;
  if (!userId) {
    userId = nanoid();
    await db.insert(schema.user).values({
      id: userId,
      name,
      email,
      emailVerified: true,
    });

    const hashed = await hashPassword(password);
    await db.insert(schema.account).values({
      id: nanoid(),
      accountId: userId,
      providerId: "credential",
      userId,
      password: hashed,
    });
    console.log(`Created user ${email}`);
  } else {
    console.log(`User ${email} already exists`);
  }

  const existingWs = await db.query.workspaces.findFirst({
    where: (w, { eq }) => eq(w.createdById, userId!),
  });

  let workspaceId = existingWs?.id;
  if (!workspaceId) {
    workspaceId = nanoid();
    await db.insert(schema.workspaces).values({
      id: workspaceId,
      name: brand.defaultWorkspaceName,
      slug: `demo-${nanoid(6)}`,
      createdById: userId!,
    });
    await db.insert(schema.workspaceMembers).values({
      id: nanoid(),
      workspaceId,
      userId: userId!,
      role: "owner",
    });
    console.log(`Created workspace ${brand.defaultWorkspaceName}`);
  }

  const docs = await db.query.documents.findMany({
    where: (d, { eq }) => eq(d.workspaceId, workspaceId!),
    limit: 1,
  });

  if (docs.length === 0) {
    const welcomeId = nanoid();
    const title = `Welcome to ${brand.name}`;
    const plain =
      `${brand.name} helps your team capture and find knowledge. ` +
      `Try search, publish a public page, and invite a teammate.`;
    await db.insert(schema.documents).values({
      id: welcomeId,
      workspaceId: workspaceId!,
      title,
      breadcrumbPath: title,
      plainTextContent: plain,
      contentJson: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: plain }],
          },
        ],
      },
      createdById: userId!,
      updatedById: userId!,
    });
    console.log("Created welcome document");
  }

  // A second verified user with no membership in the demo workspace —
  // useful for testing permissions locally (request access, private docs).
  const outsiderEmail =
    process.env.SEED_OUTSIDER_EMAIL ?? "teammate@docloom.local";
  const existingOutsider = await db.query.user.findFirst({
    where: (u, { eq }) => eq(u.email, outsiderEmail),
  });
  if (!existingOutsider) {
    const outsiderId = nanoid();
    await db.insert(schema.user).values({
      id: outsiderId,
      name: "Taylor Teammate",
      email: outsiderEmail,
      emailVerified: true,
    });
    await db.insert(schema.account).values({
      id: nanoid(),
      accountId: outsiderId,
      providerId: "credential",
      userId: outsiderId,
      password: await hashPassword(password),
    });
    console.log(`Created user ${outsiderEmail} (no workspace membership)`);
  }

  console.log("\nSeed complete.");
  console.log(`  Email:    ${email}`);
  console.log(`  Password: ${password}`);
  console.log(`  Outsider: ${outsiderEmail} (same password)`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
