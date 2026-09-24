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
| V0    | Foundation: repo, schema, RLS, auth, role-aware shell | WP-01–03 done, WP-04 next |
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

## Scripts

| Script                         | What it does                                        |
| ------------------------------ | --------------------------------------------------- |
| `npm run dev`                  | Development server                                  |
| `npm test`                     | Unit tests (Vitest)                                 |
| `npm run typecheck` / `lint`   | TypeScript and ESLint                               |
| `npm run format`               | Prettier                                            |
| `npm run db:start` / `db:stop` | Start/stop the local Supabase stack                 |
| `npm run db:reset`             | Rebuild the local database from migrations + seed   |
| `npm run db:types`             | Regenerate `src/lib/database.types.ts`              |
| `npm run db:diff`              | Diff the local database against migrations          |
| `npm run db:push`              | Apply migrations to the linked (production) project |
