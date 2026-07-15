<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Cursor Cloud specific instructions

Standard commands live in `package.json` scripts and `README.md`; the notes below only cover the non-obvious local-DB setup.

### The database only speaks the Neon HTTP protocol
The app connects to Postgres exclusively through `@neondatabase/serverless` (`neon()` HTTP driver) — there is no TCP/`pg` path in app code. Local dev therefore needs a local Postgres **plus** a tiny Neon-HTTP proxy in front of it:

- `scripts/dev-neon-proxy.mjs` (dev-only, never imported by the app) implements the Neon "SQL over HTTP" protocol on top of local Postgres via `pg`.
- With `DATABASE_URL` host `db.localtest.me`, the driver's default `fetchEndpoint` resolves to `https://api.localtest.me/sql`, so the proxy serves HTTPS on port **443**. `*.localtest.me` resolves to loopback via public DNS.
- The proxy uses a self-signed cert (auto-generated at `~/.docloom-dev/certs/`). Node trusts it via `NODE_EXTRA_CA_CERTS`, which is exported in `~/.bashrc`. Any process that hits the DB (`pnpm dev`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm test:e2e`) must inherit that env var — start them from a login shell.
- `node` was granted `cap_net_bind_service` so the proxy can bind 443 without root.

### Start services (not done by the update script)
These are already installed/configured; on a fresh VM just (re)start them:
```bash
sudo pg_ctlcluster 16 main start                     # local Postgres (db "main", user/pass postgres/postgres, pg_trgm enabled)
node scripts/dev-neon-proxy.mjs                        # Neon HTTP proxy on https://api.localtest.me:443/sql (run in background)
pnpm dev                                               # Next.js dev server on :3000
```
If the proxy or DB is down you'll see `Error connecting to database` / TLS errors from the serverless driver.

### Env files
Both `.env` and `.env.local` are needed and are git-ignored: the `tsx` scripts (`db:migrate`, `db:seed`) load `.env` via `dotenv`, while Next.js loads `.env.local`. They contain identical local values (`DATABASE_URL=postgresql://postgres:postgres@db.localtest.me/main`, a `BETTER_AUTH_SECRET`, `NEXT_PUBLIC_APP_URL`, `E2E_HAS_DATABASE=1`). Recreate from `.env.example` if missing.

### Other notes
- Migrations are intentional (not on deploy): `pnpm db:migrate`, then `pnpm db:seed`. Seed login: `demo@backbeatnotes.local` / `BackBeatNotesDemo123!` (pre-verified; email/password sign-in requires a verified user).
- `RESEND_API_KEY`/`BLOB_READ_WRITE_TOKEN` are unset locally — email logs to the console and Blob uploads are disabled; both are fine for most dev work.
- `pnpm test:e2e` reuses an already-running dev server on `:3000`; set `E2E_HAS_DATABASE=1` for the DB-dependent smoke test.
