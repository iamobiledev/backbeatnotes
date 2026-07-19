# BackBeat Notes

**BackBeat Notes — Keep your team's knowledge in rhythm.**

BackBeat Notes is a Vercel-first collaborative knowledge base built with Next.js (App Router), Neon Postgres, Better Auth, Tiptap, and Vercel Blob. Product naming lives in `src/config/brand.ts`.

## Features

- **Documents** — rich-text editing (headings, lists, checkboxes, code blocks, links, inline images) with debounced autosave and a live *Saved* indicator; Notion-style page hierarchy with a collapsible sidebar tree.
- **Wikis** — a second document type for canonical team knowledge. Wikis can be **locked** by admins: locked wikis are read-only for everyone except workspace owners/admins and platform admins.
- **Change log** — every page has an Activity history (who created/edited/renamed/moved/trashed/published/locked it, when) with autosave edits coalesced into readable sessions, alongside restorable version snapshots.
- **Organization** — favorites, recently-viewed, soft-delete trash with restore (nothing is permanently deleted from the UI), and automatic version snapshots on significant edits with preview + restore.
- **Google sign-in & domain access** — optional "Continue with Google" (Better Auth Google OAuth) so teams sign in with their existing Google Workspace accounts; `GOOGLE_HOSTED_DOMAIN` restricts Google sign-in to one org (enforced against the id token's verified `hd` claim). Workspace admins can enable **Domain access** (Settings → Domain access): anyone who signs in with a verified email at the company domain automatically joins the workspace as an Editor — no invitations needed; individual roles stay manually adjustable in Members.
- **Sharing & permissions** — Notion-style page sharing from the **Share** popover (Share | Publish tabs): invite anyone by email with **Full access / Can edit / Can view**, including people outside the workspace (new users set a password inside the invitation flow, then confirm access); a per-page **General access** switch between *Only people invited* and *Everyone at {workspace}*; a **Shared** sidebar section for pages shared with you. Every user also gets a private **Personal notebook** (its pages are invite-only but individually shareable); team workspaces where every member sees every workspace-visible page (admins manage members, editors write, viewers read); publish-to-web for public read-only pages (independent of in-app access); and a request-access screen (never an error) for links you can't open.
- **User types** — platform `admin` (creates team workspaces, locks/edits locked wikis) and `developer` (regular user). The first registered user automatically becomes an admin.
- **Email notifications** — invitation emails, "you've joined a workspace" + "your invite was accepted" emails, and document-activity alerts to a page's creator and previous editors (throttled to one email per person per page per 6 hours, per-user opt-out in Settings → Notifications). Pending invitations show when the email was sent, with one-click resend.
- **Search** — fast Postgres full-text + trigram search with weighted ranking (exact title → prefix → fuzzy → body → recency), a global **⌘K / Ctrl+K** palette with highlighted snippets and owner/date/scope filters, permission-filtered inside SQL.
- **Slack integration** — paste a doc link in Slack and get a rich inline preview (permission-aware), search with `/docs`, or ask `@backbeat-notes` for documents like a detailed description. Semantic results quote and deep-link to the matching paragraph in rich threaded cards. See [Slack integration](#slack-integration).
- **Polish** — keyboard shortcuts (press `?` in the app), loading skeletons, empty states, toasts, responsive layout with a mobile drawer.

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js App Router + React + TypeScript (strict) |
| UI | Tailwind CSS + shadcn/ui |
| Editor | Tiptap |
| Database | Neon Serverless Postgres + Drizzle ORM |
| Auth | Better Auth (email/password, Google sign-in, verification, resets, sessions) |
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

Open [http://localhost:3000](http://localhost:3000). Seed credentials default to `demo@backbeatnotes.local` / `BackBeatNotesDemo123!` (plus `teammate@backbeatnotes.local`, a second verified user with no workspace membership — handy for testing permissions).

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
| `pnpm test:perf` | Playwright performance contracts (fixture URLs optional) |
| `pnpm perf:audit` | Route TTFB and compressed asset transfer audit |
| `pnpm check` | lint + typecheck + unit tests |
| `pnpm db:generate` | Generate Drizzle migrations from schema |
| `pnpm db:migrate` | **Intentional** migration runner (not on every deploy) |
| `pnpm db:check` | Verify migrations, extensions, and workload indexes |
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
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Server | Optional — enables "Continue with Google" sign-in |
| `GOOGLE_HOSTED_DOMAIN` | Server | Optional — restrict Google sign-in to one Google Workspace org |
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
  name: "BackBeat Notes",
  tagline: "Keep your team's knowledge in rhythm.",
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
   - Production: `https://your-domain.com` (the custom domain users type in the browser — not a `*.vercel.app` alias)
   - Preview: leave unset to fall back to `VERCEL_URL`, or set a preview URL; Better Auth `baseURL.allowedHosts` also allows `*.vercel.app` on Vercel
3. Auth routes: `/api/auth/*` (browser client uses same-origin relative paths).
4. Sessions are stored in Neon (`session`, `account`, `verification`, `user`).

Supported flows: email/password, email verification, password reset, secure session cookies, invitation-based password setup/sign-in followed by explicit acceptance, sign out (current device), and sign out all devices (`POST /api/auth/revoke-sessions`). Direct `/sign-up` remains functional but is not currently advertised in the public UI.

#### Google sign-in (optional)

Let your team sign in with their existing Google accounts — no separate password:

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials) (a project in your org), configure the **OAuth consent screen**. If everyone is in one Google Workspace org, choose **Internal**.
2. Create an **OAuth client ID** of type **Web application** and add the authorized redirect URIs:
   - Production: `https://backbeatnotes.com/api/auth/callback/google` (replace the host only when deploying your own fork)
   - Local: `http://localhost:3000/api/auth/callback/google`
3. Set the environment variables and redeploy:
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — enables the **Continue with Google** button on `/sign-in` and `/sign-up` (hidden when unset).
   - `GOOGLE_HOSTED_DOMAIN` (optional, e.g. `rowsone.com`) — restricts Google sign-in to that Google Workspace org. It is sent as the account-picker hint **and enforced server-side** against the verified `hd` claim of Google's id token; other Google accounts are rejected (they can still use email/password or invitations).

Google accounts arrive with a verified email, so they skip the verification-email step. A Google sign-in whose email matches an existing verified email/password user links into the same account. New Google users get the default `developer` platform type (the regular-user type).

Merging the Google sign-in code does not configure OAuth. After redeploying,
check `/api/health`: `env.hasGoogleOAuth` must be `true`. A value of `false`
means the deployed environment does not have both the client ID and secret.
This integration is Google OAuth for Google Workspace; it is not a generic
SAML or OIDC provider.

#### Domain access (automatic workspace membership)

To let everyone at your company join a workspace without invitations, a workspace owner/admin opens **Settings → Domain access** and enters the company email domain (e.g. `rowsone.com`). From then on, anyone who signs in with a **verified** email at that domain — via Google or email/password — automatically joins that workspace as an **Editor** (`member` role). Adjust individual roles afterwards in **Settings → Members**.

Notes:

- You can only claim the domain of **your own verified email**, and each domain can be claimed by **one** workspace.
- Public email domains (gmail.com, outlook.com, …) are rejected.
- Personal notebooks never allow domain access.
- Joining is idempotent and never changes roles you set manually.
- A **pending invitation** for the same email takes precedence over domain access (so a Viewer/guest invite is not silently upgraded to Editor by auto-join). Accepting the invite upgrades roles when needed, and can apply a guest invite over an auto-joined Editor row, but never demotes an owner or admin.
- While domain access is on, a removed member re-joins on their next sign-in — turn it off first when evicting someone with a matching email.

### 6. Configure email delivery

1. Create a [Resend](https://resend.com) API key and verified domain.
2. Set `RESEND_API_KEY` and `EMAIL_FROM` (e.g. `BackBeat Notes <noreply@your-domain.com>`).
3. Without these, the console email provider logs messages (local-friendly).
4. For quick testing before a domain is verified, `EMAIL_FROM=BackBeat Notes <onboarding@resend.dev>` works, but Resend only delivers it to your own account address — switch to a verified domain for real recipients.

Emails sent: verification/reset (auth), workspace invitations (+ resend), joined-workspace + invitation-accepted confirmations, and throttled document-activity alerts (opt-out per user under Settings → Notifications).

The provider interface is in `src/lib/email/` — swap Resend without changing call sites.

### 7. Environment variables checklist

In Vercel → **Settings → Environment Variables**, set values for **Production**, **Preview**, and **Development** as appropriate:

- `DATABASE_URL` / `DATABASE_URL_UNPOOLED` (from Neon integration)
- `BETTER_AUTH_SECRET`
- `NEXT_PUBLIC_APP_URL` (production domain for Production; preview URL pattern for Preview)
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and optional `GOOGLE_HOSTED_DOMAIN`
- `RESEND_API_KEY`, `EMAIL_FROM`
- `BLOB_READ_WRITE_TOKEN` (from Blob store)
- `CRON_SECRET`

### 8. Run migrations (intentionally)

Migrations are **not** run automatically on Vercel deployments. A successful
Vercel build only proves the application compiled; it does not prove the
database was migrated.

```bash
# Local, or a trusted CI/release shell with explicitly supplied credentials
pnpm db:migrate
pnpm db:check
```

`db:migrate` applies DDL through `DATABASE_URL_UNPOOLED` when available, then
verifies the complete schema through both configured endpoints. `db:check`
does the same dual-target verification without changing data:

- `runtime` is the pooled `DATABASE_URL` used by the deployed application.
- `migration` is the direct `DATABASE_URL_UNPOOLED` used for DDL.

If the URLs are distinct, **both** must pass. A
`RUNTIME_SCHEMA_BEHIND_MIGRATION_TARGET` result means the migration command
updated one branch/database while the application is connected to another.
The reports contain target labels and readiness flags, never credentials.

The Cursor cloud development environment and the repository's normal local
`.env` files point to local Postgres. Running `pnpm db:migrate` there does
**not** migrate production. For a production release, supply both Production
URLs from a secure shell, secret store, or one-off CI job; never save
production credentials in a committed file. Confirm in Neon that the pooled
and direct endpoints identify the same project, branch, database, and role
before running the command.

Apply the same migration files to:

1. Development branch
2. Preview branch (or let Neon branching inherit schema, then migrate if needed)
3. Production branch — run once per release from a trusted machine or a one-off CI job

Use this release order:

1. `pnpm db:migrate`
2. `pnpm db:check`
3. Deploy the application
4. `curl --fail https://backbeatnotes.com/api/health`

Apply migrations before deploying code that reads new schema. Domain access requires the
`workspaces.auto_join_domain` column and its unique claim index. Ownership
transfer requires the transfer function and one-owner-per-workspace index. A
deployment is not ready until these checks pass.

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

Expect `{ "ok": true, "service": "backbeat-notes", ... }` without secrets.

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

### Performance checks

Run the route and asset audit against a local production server or deployment:

```bash
pnpm perf:audit -- --base http://localhost:3000 --routes /,/sign-in
pnpm perf:audit -- --base https://preview.example.com \
  --routes /,/sign-in,/p/example --out perf-results.json
```

Optional `--max-ttfb` and `--max-assets` flags turn measurements into failing
budgets. For deterministic scale testing, seed a large workspace explicitly:

```bash
SEED_PERF_DOCUMENTS=500 pnpm db:seed
```

Set `E2E_PERF_WORKSPACE_URL`, `E2E_PERF_DOCUMENT_URL`, and
`E2E_PUBLIC_DOCUMENT_URL` to exercise the database-backed performance
contracts. Vercel Analytics and Speed Insights collect real-user route and
Core Web Vitals data in deployed environments. Server operations slower than
250 ms emit a structured `performance.slow_operation` warning; override that
threshold with `SLOW_OPERATION_MS`.

### Performance architecture

- Next.js Cache Components provide partial prerendered shells while
  request-bound authentication and workspace data stream behind local
  Suspense boundaries.
- Security headers are emitted by Next configuration, so static and auth pages
  do not pay for a Proxy/Middleware invocation.
- Better Auth, Drizzle, sessions, memberships, and common read helpers are
  reused or request-memoized. Document access is resolved by one joined query.
- The sidebar loads only the personal/current workspace initially, caps each
  tree at 500 pages, and loads other teamspaces on expansion.
- Published and read-only documents use a safe server renderer rather than
  hydrating TipTap/ProseMirror. Published query results use tagged caches with
  immediate invalidation on publish, edit, rename, restore, trash, or
  unpublish.
- Editor image bytes upload directly from the browser to Vercel Blob. The
  server issues a narrowly scoped token and records trusted completion
  metadata; it never buffers the file in a Function.
- Search cancels superseded browser requests and uses Postgres FTS/trigram
  operators that match the GIN indexes.

Migration `0007_little_landau.sql` adds partial indexes for active,
recent, and trashed page lists plus invitation and activity-coalescing indexes.
Apply it before deploying this code. Index creation increases migration-time
I/O but does not change data. A rollback can safely `DROP INDEX` the seven
indexes declared in that migration; rolling forward is preferred.

Document paragraph indexing is derived data: canonical page content and
Postgres full-text fields save first, while optional embeddings run after the
response. A missing `document_search_blocks` migration degrades paragraph
anchors/semantic search but must never prevent creating or saving a page.
Deployments should still treat degraded search as unready:

```bash
# Safe rollout order
pnpm db:migrate
pnpm db:check
pnpm search:backfill
curl --fail https://your-deployment.vercel.app/api/health
```

`db:check` exits non-zero when required migrations, pgvector, the monotonic
document revision column, domain-access schema, ownership invariant, or
workload indexes are missing. Revision tokens prevent concurrent whole-document
saves from silently overwriting one another. `/api/health` returns 503 with
secret-free schema readiness details when the database is unavailable or
incomplete.
During rollback, keep the newer schema in place; migrations are additive and
older application versions safely ignore these tables/indexes.

`VERCEL_REGION=iad1` and a Neon `aws-us-east-1` primary describe the same
geography with provider-specific names. `/api/health` reports both
`functionRegion` and `databaseRegion`; verify their geographic mapping rather
than comparing the strings literally.

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
| Inline link previews (unfurls) | Paste any doc link in Slack → rich card with title, ~200-char excerpt, author, last-edited time, and an *Open in BackBeat Notes* button. Permission-aware: private/trashed/deleted docs and links shared by unlinked users render a neutral "open in BackBeat Notes to view" card — content never leaks. |
| `/docs <query>` | Ephemeral search results (permission-filtered to *your* linked identity) with *Open* and *Share to channel* buttons. |
| `@backbeat-notes find the onboarding doc` | Mention the bot in natural language — it extracts a keyword query and replies in the originating thread with rich document cards. |
| `@backbeat-notes find docs like this: password reset emails never arrive` | With `OPENAI_API_KEY`, searches by meaning across paragraph embeddings, quotes the closest paragraph, and links directly to it. Without OpenAI it falls back to scoped keyword search. |
| Share to Slack from the app | In any page's Share dialog: pick a channel, add an optional message, post a rich card. |

### 1. Create the Slack app

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From a manifest**.
2. Pick your Slack workspace, then paste the contents of [`slack-app-manifest.json`](./slack-app-manifest.json), replacing every `YOUR_APP_DOMAIN` with your deployed domain (e.g. `backbeatnotes.vercel.app`) — or your ngrok domain for local testing.
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

1. In BackBeat Notes: **Settings → Slack → Connect Slack** (workspace admins only). This runs the OAuth install; the bot token is stored encrypted (AES-256-GCM) in Postgres.
2. Each user who wants permission-aware search/unfurls clicks **Settings → Slack → Link my account** (Sign in with Slack, OIDC).
3. In Slack, `/invite @backbeat-notes` into channels where you want the bot to post shared cards.

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

The simulation suite covers the signature checks, the 3-second ack budget, event redelivery idempotency, the full unfurl permission matrix, `@backbeat-notes` mentions, `/docs`, and share-to-channel.

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
- **Direct shares** — `document_permissions` rows grant page access independent of workspace membership. Inviting an email without an account creates a pending `document_invitations` row (7-day token); `/invitations/[token]` lets the recipient set a password or sign in, then explicitly converts the invitation to a permission.
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
- Not-found UI + `noindex` when not public / missing (a streamed PPR shell may
  carry HTTP 200, per Next.js soft-404 semantics)
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
3. Confirm both URLs map to the same Neon project, branch, database, and role. `db:migrate` and `db:check` fail when only one configured target has the required schema.
4. Check Neon console: branch awake, IP allow list (Neon serverless typically allows Vercel egress).
5. Ensure preview env vars do not point at production.
6. Align `vercel.json` `regions` with Neon primary region.

### Database migration reported success but the app reports an update pending

1. Fetch `/api/health` and inspect `database.domainAccessSchemaReady` and `database.ownershipSchemaReady`.
2. Run the current `pnpm db:check`. `RUNTIME_SCHEMA_BEHIND_MIGRATION_TARGET` confirms that the direct migration endpoint is current while the pooled application endpoint is stale or points elsewhere.
3. Correct the Neon/Vercel Production mapping before rerunning migrations. Repeatedly migrating the wrong direct endpoint cannot repair the runtime database.
4. Apply every committed migration through the latest journal entry; do not manually insert migration-journal rows.

### Google sign-in button is missing

1. Check `/api/health` → `env.hasGoogleOAuth`. It must be `true`.
2. Set both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the same Vercel environment and redeploy.
3. Add the exact custom-domain callback URL to the Google OAuth Web client.
4. Set `GOOGLE_HOSTED_DOMAIN` only when sign-in should be restricted to one Google Workspace organization; this variable does not enable OAuth by itself.

### Missing environment variables

1. Compare Vercel env settings to `.env.example`.
2. Ensure variables are enabled for the correct environment (Production / Preview / Development).
3. Redeploy after changing env vars.
4. Check `/api/health` for presence flags (not values).

### Auth not working on production domain

1. `NEXT_PUBLIC_APP_URL` / `BETTER_AUTH_URL` must be the HTTPS **custom domain** (e.g. `https://backbeatnotes.com`), not a `*.vercel.app` alias. On Vercel Production, invite/OAuth/email links are also **code-pinned** to `brand.siteUrl` (`https://backbeatnotes.com`) so a mis-set alias cannot leak into emails.
2. The browser auth client calls same-origin `/api/auth` (it does **not** hardcode `NEXT_PUBLIC_APP_URL`), so sign-in works on both the custom domain and Vercel aliases.
3. If you still see CORS errors to a different hostname, an old client bundle is caching a cross-origin `baseURL` — redeploy after this fix.
4. Optional: set `BETTER_AUTH_TRUSTED_ORIGINS` to a comma-separated list of extra hosts/origins (www, staging, etc.).
5. Rotate/check `BETTER_AUTH_SECRET`.
6. Clear cookies and retry.

### Emails (invitations, shares, verification) not sending

1. Check `https://your-deployment/api/health` → `env.emailDelivery`. `"console-only"` means `RESEND_API_KEY` and/or `EMAIL_FROM` are **not set** — emails are only logged to the function console, never delivered. Production logs also show a `email.not_configured` warning.
2. Set `RESEND_API_KEY` and `EMAIL_FROM` in Vercel → Settings → Environment Variables (Production + Preview) and redeploy.
3. `EMAIL_FROM` must use a domain verified in Resend (e.g. `BackBeat Notes <noreply@your-domain.com>`). `onboarding@resend.dev` only delivers to your own Resend account address.
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
