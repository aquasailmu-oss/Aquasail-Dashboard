# Aquasail Dashboard

Watersports operations platform for AquaSail Watersports Ltd (Mauritius): bookings,
pricing, fleet tracking, and daily reconciliation.

- `src/`: the application (Next.js 15 App Router + Supabase), built phase by phase
  from the build plan. Conventions and the plan adjustments are in `CLAUDE.md`.
- `prototype/index.html`: the standalone UI prototype shown to the client. Open it
  directly in a browser. It is the reference for screens and behaviour.

## Status

| Phase | Scope                                                 | State                     |
| ----- | ----------------------------------------------------- | ------------------------- |
| V0    | Foundation: repo, schema, RLS, auth, role-aware shell | WP-01–08 done, WP-09 next |
| V1    | Core booking system                                   | Not started               |
| V2–V4 | Ticketing, accounting, capacity/analytics             | Planned                   |

## Running it

Requirements: Node 20+, Docker (for the local Supabase stack).

```bash
npm install
cp .env.example .env.local   # then fill in, see below
npm run db:start             # local Supabase; prints the URL and keys
npm run dev                  # http://localhost:3000
```

For `.env.local`, use the `API URL`, `anon key` and `service_role key` that
`npm run db:start` prints.

### Codespaces: Docker networking fix

In this Codespace a leftover legacy iptables table drops traffic on custom Docker
networks, so `supabase start` fails at "Initialising schema". Run this once per
Codespace (it resets when the Codespace is rebuilt):

```bash
sudo iptables-legacy -I DOCKER-USER -j ACCEPT
```

The rule is also lost whenever Docker restarts (for example after the disk fills
up). If `supabase start` stalls with `PGRST000` connection errors, run it again.

### Codespaces: disk space

The default Codespace has a single 32 GB disk shared by the OS, Docker images
and the repo. To fit, `supabase/config.toml` switches off the local services the
project does not use yet: Studio, analytics, Edge Functions (needed from V2) and
Realtime. Turn one back on by setting its `enabled = true`; its image downloads
on the next `npm run db:start`. Check space with `df -h /`; a 64 GB machine type
removes the constraint. When the disk is full, file writes fail silently and
leave empty files, so check `git status` after freeing space.

## Scripts

| Script                         | What it does                                                               |
| ------------------------------ | -------------------------------------------------------------------------- |
| `npm run dev`                  | Development server                                                         |
| `npm test`                     | Unit tests (Vitest)                                                        |
| `npm run test:db`              | Database tests (pgTAP, `supabase/tests/`)                                  |
| `npm run test:rls`             | RLS attack suite (`tests/rls/`, local stack) — must pass before any deploy |
| `npm run typecheck` / `lint`   | TypeScript and ESLint                                                      |
| `npm run format`               | Prettier                                                                   |
| `npm run db:start` / `db:stop` | Start/stop the local Supabase stack                                        |
| `npm run db:reset`             | Rebuild the local database from migrations + seed                          |
| `npm run db:types`             | Regenerate `src/lib/database.types.ts`                                     |
| `npm run db:diff`              | Diff the local database against migrations                                 |
| `npm run db:push`              | Apply migrations to the linked (production) project                        |
