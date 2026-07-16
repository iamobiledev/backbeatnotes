<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Cursor Cloud specific instructions

Standard commands live in `package.json` scripts and `README.md`; the notes below only cover the non-obvious local setup. The update script only runs `pnpm install`; Postgres (with data + extensions) and the `.env` files are baked into the VM snapshot, so on a fresh VM you just (re)start services.

### Local DB uses plain Postgres via the `node-postgres` driver (no Neon proxy)
`src/db/create-db.ts` auto-selects the `node-postgres` driver whenever `DATABASE_URL`'s host is local/loopback (`localhost`, `127.0.0.1`, `*.local`, `*.internal`) — the Neon HTTP driver is only used for real Neon hosts. So local dev needs **only** a plain local Postgres; the Neon-HTTP proxy in `scripts/dev-neon-proxy.mjs` is not used here. See README "No Neon account needed for local dev".

- Cluster: PostgreSQL 16 (`sudo pg_ctlcluster 16 main start`), database `main`, role/password `postgres`/`postgres`, listening on `localhost:5432`.
- Required extensions (already created in `main`): `pg_trgm`, `unaccent`, and `vector` (pgvector, `postgresql-16-pgvector`). `pnpm db:check` fails if `vector` or the workload indexes are missing.

### Start services (not done by the update script)
```bash
sudo pg_ctlcluster 16 main start   # local Postgres (db "main", user/pass postgres/postgres)
pnpm dev                           # Next.js dev server on :3000
```
Then `curl -s localhost:3000/api/health` should report `"status":"ready"` with `database.connected:true`.

### Env files
Both `.env` and `.env.local` are needed and are git-ignored: the `tsx` scripts (`db:migrate`, `db:seed`, `db:check`) load `.env` via `dotenv`, while Next.js loads `.env.local`. They hold identical local values — `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/main`, a 32+ char `BETTER_AUTH_SECRET`, `NEXT_PUBLIC_APP_URL=http://localhost:3000`, `E2E_HAS_DATABASE=1`. Recreate both from these values if missing (generate a secret with `openssl rand -base64 32`). Restart `pnpm dev` after editing them — the DB client is memoized per process.

### Migrations & seed
Intentional (not on deploy): `pnpm db:migrate`, then `pnpm db:seed`. Seed login: `demo@backbeatnotes.local` / `BackBeatNotesDemo123!` (platform admin, pre-verified — email/password sign-in requires a verified user). A second user `teammate@backbeatnotes.local` (same password) has no workspace membership, for permission testing.

### Tests
- Unit tests need no DB: `pnpm test` (also `pnpm lint`, `pnpm typecheck`, or all three via `pnpm check`).
- Playwright e2e reuses an already-running dev server: `E2E_HAS_DATABASE=1 E2E_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/main PLAYWRIGHT_BASE_URL=http://localhost:3000 pnpm test:e2e`. Non-obvious gotchas:
  - Some specs read the DB directly via the `psql` CLI and have **mismatched** hard-coded default URLs (one defaults to `.../main`, another to `.../docloom`), so you **must** set `E2E_DATABASE_URL` to the real connection string or those specs fail with `psql` connection errors.
  - Sign-in is rate-limited; the parallel suite trips HTTP 429 unless the **dev server** is started with `E2E_DISABLE_AUTH_RATE_LIMIT=1` (i.e. `E2E_DISABLE_AUTH_RATE_LIMIT=1 pnpm dev`). This flag is read server-side, so it must be on the server process, not the Playwright process.
  - `playwright install chromium` is required once (cached in the snapshot).
  - `e2e/performance.spec.ts`'s static-asset transfer-size budget is written for a production build and **is expected to fail against the dev server** (unminified/uncompressed dev bundles). Everything else in the suite passes.

### Other notes
- `RESEND_API_KEY`/`BLOB_READ_WRITE_TOKEN` are unset locally — email logs to the console and Blob uploads are disabled; both are fine for most dev work.
