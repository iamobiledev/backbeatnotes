# Docloom

**Docloom — Your team's knowledge, organized.**

Docloom is a Vercel-first collaborative knowledge base built with Next.js (App Router), Neon Postgres, Better Auth, Tiptap, and Vercel Blob. Product naming lives in `src/config/brand.ts` so the temporary name is easy to replace later.

## Features

- **Documents** — rich-text editing (headings, lists, checkboxes, code blocks, links, inline images) with debounced autosave and a live *Saved* indicator; Notion-style page hierarchy with a collapsible sidebar tree.
- **Wikis** — a second document type for canonical team knowledge. Wikis can be **locked** by admins: locked wikis are read-only for everyone except workspace owners/admins and platform admins.
- **Change log** — every page has an Activity history (who created/edited/renamed/moved/trashed/published/locked it, when) with autosave edits coalesced into readable sessions, alongside restorable version snapshots.
- **Organization** — favorites, recently-viewed, soft-delete trash with restore (nothing is permanently deleted from the UI), and automatic version snapshots on significant edits with preview + restore.
- **Sharing & permissions** — Notion-style page sharing from the **Share** popover (Share | Publish tabs): invite anyone by email with **Full access / Can edit / Can view**, including people outside the workspace (emails without an account get a pending invitation that converts on sign-up); a per-page **General access** switch between *Only people invited* and *Everyone at {workspace}*; a **Shared** sidebar section for pages shared with you. Every user also gets a private **Personal notebook** (its pages are invite-only but individually shareable); team workspaces where every member sees every workspace-visible page (admins manage members, editors write, viewers read); publish-to-web for public read-only pages (independent of in-app access); and a request-access screen (never an error) for links you can't open.
- **User types** — platform `admin` (creates team workspaces, locks/edits locked wikis) and `developer` (regular user). The first registered user automatically becomes an admin.
- **Email notifications** — invitation emails, "you've joined a workspace" + "your invite was accepted" emails, and document-activity alerts to a page's creator and previous editors (throttled to one email per person per page per 6 hours, per-user opt-out in Settings → Notifications). Pending invitations show when the email was sent, with one-click resend.
- **Search** — fast Postgres full-text + trigram search with weighted ranking (exact title → prefix → fuzzy → body → recency), a global **⌘K / Ctrl+K** palette with highlighted snippets and owner/date/scope filters, permission-filtered inside SQL.
- **Slack integration** — paste a doc link in Slack and get a rich inline preview (permission-aware), search with `/docs`, or ask `@docloom` for documents like a detailed description. Semantic results quote and deep-link to the matching paragraph in rich threaded cards. See [Slack integration](#slack-integration).
- **Polish** — keyboard shortcuts (press `?` in the app), loading skeletons, empty states, toasts, responsive layout with a mobile drawer.

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js App Router + React + TypeScript (strict) |
| UI | Tailwind CSS + shadcn/ui |
| Editor | Tiptap |
| Database | Neon Serverless Postgres + Drizzle ORM |
| Auth | Better Auth (email/password, verification, resets, sessions) |
| Email | Resend behind a reusable provider interface |
| Files | Vercel Blob (+ metadata in Neon) |
| Search | Neon Postgres FTS + `pg_trgm` + optional `pgvector` semantic paragraphs |
| Tests | Vitest + Playwright |
| Hosting | Vercel (Functions, Cron, Blob, Analytics, preview deploys) |

There is no separate traditional backend. Frontend, Server Components, Server Actions, Route Handlers, auth, authorization, DB access, search, public pages, uploads, and invitations all run inside the Next.js app on Vercel Functions.

## Quick start (local)

```bash
pnpm install
cp .env.example .env.local
# Fill DATABASE_URL, DATABASE_URL_UNPOOLED, BETTER_AUTH_SECRET, NEXT_PUBLIC_APP_URL

pnpm db:migrate
pnpm db:seed
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Seed credentials default to `demo@docloom.local` / `DocloomDemo123!` (plus `teammate@docloom.local`, a second verified user with no workspace membership — handy for testing permissions).

**No Neon account needed for local dev:** when `DATABASE_URL` points at `localhost` (or `DATABASE_DRIVER=pg` is set), the app automatically uses the `node-postgres` driver instead of the Neon HTTP driver. Install pgvector for your PostgreSQL version (for example, `sudo apt install postgresql-16-pgvector` on Ubuntu), then enable the required extensions:

```bash
sudo -u postgres psql -c "CREATE ROLE docloom LOGIN PASSWORD 'docloom' SUPERUSER;"
sudo -u postgres createdb -O docloom docloom
sudo -u postgres psql -d docloom -c "CREATE EXTENSION pg_trgm; CREATE EXTENSION unaccent; CREATE EXTENSION vector;"
# .env.local → DATABASE_URL=postgresql://docloom:docloom@localhost:5432/docloom
```

### Scripts

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Local development server |
| `pnpm build` / `pnpm start` | Production build & serve |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest unit tests |
| `pnpm test:e2e` | Playwright smoke tests |
| `pnpm check` | lint + typecheck + unit tests |
| `pnpm db:generate` | Generate Drizzle migrations from schema |
| `pnpm db:migrate` | **Intentional** migration runner (not on every deploy) |
| `pnpm db:seed` | Local development seed |
| `pnpm db:studio` | Drizzle Studio |

## Environment variables

See [`.env.example`](./.env.example) for the full list. Required for a working deploy:

| Variable | Scope | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Server | Pooled Neon URL for app queries |
| `DATABASE_URL_UNPOOLED` | Server | Direct Neon URL for migrations |
| `BETTER_AUTH_SECRET` | Server | `openssl rand -base64 32` |
| `NEXT_PUBLIC_APP_URL` | Public | Canonical app URL (no trailing slash) |
| `BETTER_AUTH_URL` | Server | Optional; defaults to `NEXT_PUBLIC_APP_URL` |
| `RESEND_API_KEY` / `EMAIL_FROM` | Server | Transactional email (console fallback in local) |
| `BLOB_READ_WRITE_TOKEN` | Server | Vercel Blob store token |
| `CRON_SECRET` | Server | Bearer token for Cron routes |
| `SLACK_CLIENT_ID` | Server | Slack app client id (optional — enables the Slack integration) |
| `SLACK_CLIENT_SECRET` | Server | Slack app client secret |
| `SLACK_SIGNING_SECRET` | Server | Verifies incoming Slack webhooks |
| `SLACK_TOKEN_ENCRYPTION_KEY` | Server | 32-byte base64 key (`openssl rand -base64 32`) — encrypts Slack bot tokens at rest |
| `ANTHROPIC_API_KEY` | Server | Optional — improves keyword extraction for conversational Slack requests |
| `OPENAI_API_KEY` | Server | Optional — enables paragraph-level semantic similarity in Slack with `text-embedding-3-small`; lexical fallback works without it |

Typed validation lives in `src/env/server.ts` (server-only) and `src/env/client.ts` (browser-safe). Missing required vars fail with a clear message. Database credentials are never exposed to the browser.

Set `SKIP_ENV_VALIDATION=1` only for offline lint/typecheck.

## Branding

```ts
// src/config/brand.ts
export const brand = {
  name: "Docloom",
  tagline: "Your team's knowledge, organized.",
  // ...
};
```

Import `brand` instead of hardcoding the product name.

---

## Deployment on Vercel

### 1. Create the Vercel project

1. Push this repository to GitHub.
2. In [Vercel](https://vercel.com): **Add New… → Project → Import** the repo.
3. Framework preset: **Next.js**. Build command: `pnpm run build` (also set in `vercel.json`).
4. Root directory: repository root.
5. Do **not** enable Docker or a custom persistent server.

`vercel.json` pins Functions to region `iad1` (US East). Change `regions` to match your Neon primary region for lower latency.

### 2. Connect an existing Neon project

1. Prefer the **Neon Vercel Integration** from the Vercel Marketplace / Neon console.
2. Select your existing Neon account and project.
3. Map:
   - **Production** → production Neon branch/database
   - **Preview** → Neon preview branching (isolated DB per PR when supported)
   - **Development** → local `.env.local` (never point local at production)
4. Confirm Vercel injects `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct).

Preview deployments must **not** use the production database. If preview branching is unavailable, create a dedicated preview Neon branch and set preview env vars manually.

### 3. Neon database branches

| Environment | Neon target |
| --- | --- |
| Local | Personal/dev branch or local Neon branch |
| Vercel Preview | Integration-managed preview branch (or dedicated preview DB) |
| Production | Production branch only |

### 4. Create the Vercel Blob store

1. Vercel project → **Storage → Create → Blob**.
2. Connect the store to the project (Production + Preview).
3. `BLOB_READ_WRITE_TOKEN` is injected automatically.

Private workspace files use private Blob access. Public document assets may use public Blob when appropriate. Metadata (URL, pathname, MIME, size, workspace, uploader, document, access, timestamps) is stored in Neon (`files` table).

### 5. Configure Better Auth

1. Generate `BETTER_AUTH_SECRET`.
2. Set `NEXT_PUBLIC_APP_URL` (and optionally `BETTER_AUTH_URL`) to:
   - Production: `https://your-domain.com`
   - Preview: leave as the preview URL or use a wildcard-aware setup; Better Auth `trustedOrigins` uses the configured app URL.
3. Auth routes: `/api/auth/*`.
4. Sessions are stored in Neon (`session`, `account`, `verification`, `user`).

Supported flows: email/password, email verification, password reset, secure session cookies, workspace invitations, accept invitation, sign out (current device), sign out all devices (`POST /api/auth/revoke-sessions`).

### 6. Configure email delivery

1. Create a [Resend](https://resend.com) API key and verified domain.
2. Set `RESEND_API_KEY` and `EMAIL_FROM` (e.g. `Docloom <noreply@your-domain.com>`).
3. Without these, the console email provider logs messages (local-friendly).
4. For quick testing before a domain is verified, `EMAIL_FROM=Docloom <onboarding@resend.dev>` works, but Resend only delivers it to your own account address — switch to a verified domain for real recipients.

Emails sent: verification/reset (auth), workspace invitations (+ resend), joined-workspace + invitation-accepted confirmations, and throttled document-activity alerts (opt-out per user under Settings → Notifications).

The provider interface is in `src/lib/email/` — swap Resend without changing call sites.

### 7. Environment variables checklist

In Vercel → **Settings → Environment Variables**, set values for **Production**, **Preview**, and **Development** as appropriate:

- `DATABASE_URL` / `DATABASE_URL_UNPOOLED` (from Neon integration)
- `BETTER_AUTH_SECRET`
- `NEXT_PUBLIC_APP_URL` (production domain for Production; preview URL pattern for Preview)
- `RESEND_API_KEY`, `EMAIL_FROM`
- `BLOB_READ_WRITE_TOKEN` (from Blob store)
- `CRON_SECRET`

### 8. Run migrations (intentionally)

Migrations are **not** run automatically on every Vercel deployment.

```bash
# Local / CI with credentials
pnpm db:migrate
```

Use `DATABASE_URL_UNPOOLED` for DDL. Apply the same migration files to:

1. Development branch
2. Preview branch (or let Neon branching inherit schema, then migrate if needed)
3. Production branch — run once per release from a trusted machine or a one-off CI job

SQL lives in `drizzle/`. Generate new migrations with `pnpm db:generate` after schema changes.

### 9. Seed development data

```bash
pnpm db:seed
```

Refuses to run in production unless `SEED_ALLOW_PRODUCTION=true`.

### 10. Deploy

- **Preview**: open a pull request — Vercel creates a preview deployment URL automatically.
- **Production**: merge to the production branch (usually `main`). Attach a custom domain under Vercel → Domains.

### 11. Post-deploy health check

```bash
curl https://your-deployment.vercel.app/api/health
```

Expect `{ "ok": true, "service": "docloom", ... }` without secrets.

### 12. Tests

```bash
pnpm test                # unit tests (access matrix, unfurl matrix, crypto, signatures, versioning, blocks, rate limiter)
TEST_DATABASE_URL=postgresql://… pnpm test   # + search-ranking/permission integration tests against a real Postgres

# Playwright e2e (full product flows; requires a seeded database)
E2E_HAS_DATABASE=1 PLAYWRIGHT_BASE_URL=http://localhost:3000 pnpm test:e2e

# Against a deployed preview or production URL
PLAYWRIGHT_BASE_URL=https://your-preview.vercel.app pnpm test:e2e

# Slack integration simulation (see “Slack integration → Testing without Slack”)
python3 scripts/slack-sim.py
```

### Rolling back a deployment

1. Vercel → Project → **Deployments**.
2. Open the last known-good production deployment → **Promote to Production**.
3. If a migration was applied and is incompatible, restore the Neon branch (point-in-time or previous branch) **before** or **as part of** the rollback — schema roll-forward is preferred when possible.

### Custom domain

1. Vercel → **Domains** → add `app.your-domain.com` (or apex).
2. Update DNS as instructed.
3. Set Production `NEXT_PUBLIC_APP_URL` / `BETTER_AUTH_URL` to `https://your-domain.com`.
4. Redeploy so auth cookies and email links use the production domain.

---

## Slack integration

The goal: find and share docs without leaving Slack, and make any pasted doc link render as a rich inline preview (like Notion links do).

**What you get once connected:**

| Feature | How |
| --- | --- |
| Inline link previews (unfurls) | Paste any doc link in Slack → rich card with title, ~200-char excerpt, author, last-edited time, and an *Open in Docloom* button. Permission-aware: private/trashed/deleted docs and links shared by unlinked users render a neutral "open in Docloom to view" card — content never leaks. |
| `/docs <query>` | Ephemeral search results (permission-filtered to *your* linked identity) with *Open* and *Share to channel* buttons. |
| `@docloom find the onboarding doc` | Mention the bot in natural language — it extracts a keyword query and replies in the originating thread with rich document cards. |
| `@docloom find docs like this: password reset emails never arrive` | With `OPENAI_API_KEY`, searches by meaning across paragraph embeddings, quotes the closest paragraph, and links directly to it. Without OpenAI it falls back to scoped keyword search. |
| Share to Slack from the app | In any page's Share dialog: pick a channel, add an optional message, post a rich card. |

### 1. Create the Slack app

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From a manifest**.
2. Pick your Slack workspace, then paste the contents of [`slack-app-manifest.json`](./slack-app-manifest.json), replacing every `YOUR_APP_DOMAIN` with your deployed domain (e.g. `docloom.vercel.app`) — or your ngrok domain for local testing.
3. Create the app. Under **Basic Information → App Credentials**, copy the **Client ID**, **Client Secret**, and **Signing Secret**.

The manifest requests only the scopes the features need: `links:read`, `links:write`, `chat:write`, `commands`, `app_mentions:read` (bot) and `openid email` (user identity linking).

### 2. Configure environment variables

```bash
SLACK_CLIENT_ID=…
SLACK_CLIENT_SECRET=…
SLACK_SIGNING_SECRET=…
SLACK_TOKEN_ENCRYPTION_KEY=$(openssl rand -base64 32)
# optional keyword interpretation:
ANTHROPIC_API_KEY=…
# optional semantic paragraph search:
OPENAI_API_KEY=…
```

Redeploy (or restart `pnpm dev`). Without these variables every Slack surface shows an honest "not configured" state — nothing breaks.

### 3. Connect a workspace

1. In Docloom: **Settings → Slack → Connect Slack** (workspace admins only). This runs the OAuth install; the bot token is stored encrypted (AES-256-GCM) in Postgres.
2. Each user who wants permission-aware search/unfurls clicks **Settings → Slack → Link my account** (Sign in with Slack, OIDC).
3. In Slack, `/invite @docloom` into channels where you want the bot to post shared cards.

Slack will verify the events URL (`/api/slack/events`) when the app is created — the endpoint answers the `url_verification` challenge automatically.

After applying migrations and setting `OPENAI_API_KEY`, index existing pages once:

```bash
pnpm search:backfill
```

The command adds stable internal paragraph IDs, synchronizes paragraph rows,
and embeds missing rows. It is idempotent and does not change visible content
or document recency. New edits are synchronized automatically.

> **Data processing:** semantic queries and bounded paragraph text are sent to
> OpenAI’s embeddings API. Keep `OPENAI_API_KEY` server-side and review your
> organization’s OpenAI data-processing policy before enabling the feature.

### 4. Local development with ngrok

Slack must be able to reach your machine for events/commands:

```bash
ngrok http 3000
# → https://<random>.ngrok-free.app
```

1. Use the ngrok domain as `YOUR_APP_DOMAIN` in the manifest (or update the URLs under **Event Subscriptions**, **Interactivity**, **Slash Commands**, **OAuth redirect URLs**, and **unfurl domains** in the app settings).
2. Set `NEXT_PUBLIC_APP_URL=https://<random>.ngrok-free.app` in `.env.local` so generated doc links use a domain Slack will unfurl.
3. Restart `pnpm dev` and install the app into your Slack workspace.

### 5. Testing without Slack at all

`scripts/slack-stub.mjs` is a tiny local mock of the Slack API:

```bash
node scripts/slack-stub.mjs                 # listens on :4571
# .env.local → SLACK_API_BASE=http://localhost:4571
python3 scripts/slack-sim.py                # simulates signed Slack webhooks end-to-end
curl http://localhost:4571/calls            # inspect exactly what the app sent to "Slack"
```

The simulation suite covers the signature checks, the 3-second ack budget, event redelivery idempotency, the full unfurl permission matrix, `@docloom` mentions, `/docs`, and share-to-channel.

### Reliability & security notes

- All Slack endpoints verify the `v0` request signature (HMAC, ±5 min replay window) before doing anything, and are rate-limited.
- Handlers ack immediately; doc lookups, card rendering, and Slack API calls run after the response (`next/server`'s `after()`), keeping well inside Slack's 3-second window.
- Event redeliveries are deduplicated via a `slack_events` idempotency table (pruned daily by cron).
- Slack API failures are logged with context and degrade gracefully — a failed unfurl never breaks anything user-facing.
- Bot tokens are encrypted at rest; unfurl decisions are unit-tested as a security matrix (`src/lib/slack/__tests__`).

---

## Architecture notes

### Authorization

Workspace IDs, roles, and permissions are resolved on the server from Neon membership rows. Client-supplied roles are never trusted (`src/lib/permissions.ts`).

### Page-level sharing

`computeDocumentAccess()` (`src/lib/documents/access.ts`) is the single source of truth, mirrored in search SQL and Slack unfurling:

- **Levels** — `Full access` (edit + manage sharing), `Can edit`, `Can view`. Workspace owners/admins and the page creator implicitly have full access; members edit; guests view.
- **Direct shares** — `document_permissions` rows grant page access independent of workspace membership. Inviting an email without an account creates a pending `document_invitations` row (7-day token, accepted at `/invitations/[token]`) that converts to a permission on sign-up.
- **General access** — per page: *Only people invited* (`visibility = private`; only the creator + direct shares can open it) or *Everyone at {workspace}* (`visibility = workspace`). Personal-notebook pages are always invite-only but can be shared person-by-person.
- **Publish to web** — tracked by `published_at`/`public_slug` alone and fully independent of in-app access: an invite-only page can still be published read-only at `/p/[slug]`.

### Search

`src/lib/search` implements a `SearchService` interface. The Neon implementation uses:

- `pg_trgm` + GIN for fuzzy titles
- `tsvector` / FTS for body content
- Optional pgvector HNSW cosine search over stable TipTap paragraphs
- Weighted ranking (exact title → prefix → fuzzy → terms → body → recency)
- Permission filtering **inside** SQL via `workspace_members`

Replace with Typesense/Meilisearch later without changing the UI.

### Public documents

- Route: `/p/[slug]` (stable public slug, not internal IDs)
- Unauthenticated, read-only
- Open Graph + SEO metadata
- 404 when not public / missing
- `revalidatePath` on publish/unpublish

### Cron (Vercel Cron)

| Path | Schedule | Purpose |
| --- | --- | --- |
| `/api/cron/expire-invitations` | daily 03:00 UTC | Expire pending invitations |
| `/api/cron/prune-versions` | daily 03:30 UTC | Prune old document versions |

Both require `Authorization: Bearer $CRON_SECRET`.

### Observability

- Production-safe JSON logging in `src/lib/logger.ts` (redacts secrets)
- `@vercel/analytics` is enabled in the root layout
- Optional: connect Vercel log drains / OpenTelemetry later without changing app architecture

### What this architecture avoids

Long-running processes, sticky sessions, always-on WebSockets, local filesystem persistence, Docker in production, continuous background workers, and auto-destructive migrations on deploy.

---

## Troubleshooting

### Database connection failures

1. Confirm `DATABASE_URL` is the **pooled** (`-pooler`) connection for the app.
2. Confirm `DATABASE_URL_UNPOOLED` is the **direct** host for migrations.
3. Check Neon console: branch awake, IP allow list (Neon serverless typically allows Vercel egress).
4. Ensure preview env vars do not point at production.
5. Align `vercel.json` `regions` with Neon primary region.

### Missing environment variables

1. Compare Vercel env settings to `.env.example`.
2. Ensure variables are enabled for the correct environment (Production / Preview / Development).
3. Redeploy after changing env vars.
4. Check `/api/health` for presence flags (not values).

### Auth not working on production domain

1. `NEXT_PUBLIC_APP_URL` / `BETTER_AUTH_URL` must match the HTTPS production domain.
2. Rotate/check `BETTER_AUTH_SECRET`.
3. Confirm email verification links use the same domain.
4. Clear cookies and retry.

### Emails (invitations, shares, verification) not sending

1. Check `https://your-deployment/api/health` → `env.emailDelivery`. `"console-only"` means `RESEND_API_KEY` and/or `EMAIL_FROM` are **not set** — emails are only logged to the function console, never delivered. Production logs also show a `email.not_configured` warning.
2. Set `RESEND_API_KEY` and `EMAIL_FROM` in Vercel → Settings → Environment Variables (Production + Preview) and redeploy.
3. `EMAIL_FROM` must use a domain verified in Resend (e.g. `Docloom <noreply@your-domain.com>`). `onboarding@resend.dev` only delivers to your own Resend account address.
4. Invitations are never lost on email failure — admins can hit **Resend** in Settings → Members once delivery works.

### Blob upload failures

1. Confirm Blob store is linked and `BLOB_READ_WRITE_TOKEN` is set.
2. Check MIME allow list and 10 MB size limit in `src/lib/blob/upload.ts`.
3. Confirm the user is a workspace member with edit permission.

---

## Project layout

```
src/
  config/brand.ts          # Product naming
  env/                     # Zod env validation
  db/                      # Drizzle schema + Neon client
  lib/                     # Auth, email, search, blob, permissions, documents
  components/              # UI + editor
  app/                     # App Router pages, actions, API routes
drizzle/                   # SQL migrations
scripts/migrate.ts         # Production-safe migrate
scripts/seed.ts            # Dev seed
e2e/                       # Playwright smoke tests
vercel.json                # Regions, build, crons
```

## License

Private / unpublished unless otherwise specified.
