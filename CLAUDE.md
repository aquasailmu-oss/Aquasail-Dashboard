# AquaSail Ops — CLAUDE.md

Operations and booking system for AquaSail Watersports Ltd, Mauritius. Reception
creates bookings; an accountant reports on them; island staff scan tickets (V2).
Money and audit correctness matter more than elegance.

The build follows `AquasailOperationsPlatform.pdf` (Build Plan v1.0, work packages
WP-01 to WP-21), adjusted to the approved UI prototype in `prototype/index.html`.
Where the two disagree, the "Adjustments" section below wins.

## Stack

Next.js 15 App Router, TypeScript strict, Tailwind v4, shadcn/ui-style components.
Supabase: Postgres, Auth, Storage. Hosted on Vercel.
No ORM. Generated types in `src/lib/database.types.ts`.

## Non-negotiable rules

1. Schema changes only via SQL files in `supabase/migrations/`. Never via the
   dashboard. Regenerate types after every migration.
2. All database access happens in server code (Server Components, Server Actions,
   Route Handlers) using the user's session client (`src/lib/supabase/server.ts`),
   so RLS applies. The browser never writes to the database. The service-role
   client (`src/lib/supabase/admin.ts`) is only for scheduled jobs, internal
   webhooks, and the admin-guarded user invite action.
3. Money is integer cents (bigint) in the database and the branded `Cents` type in
   TypeScript (`src/lib/money.ts`). Never floats. Format only with `formatRs()`.
4. Dates and times: everything business-facing is computed in Indian/Mauritius via
   `src/lib/dates.ts` (`businessDate()`, `formatDateShort()`, ...). Never call
   `new Date().toISOString().slice(0,10)`.
5. Prices are resolved server-side from `price_rules` by `src/lib/pricing/`. The
   client never computes or submits a price. Bookings store a price snapshot.
6. Prices are effective-dated and never overwritten. Changes go through the
   `set_price()` database function only.
7. Every Server Action: Zod-validate its input, check the role with
   `requireRole()`, return `Result<T>` (`src/lib/result.ts`). Errors are
   human-readable strings — a receptionist never sees "PGRST116".
8. Nothing is ever hard-deleted. Bookings are cancelled; catalogue rows are
   deactivated; payments are corrected with a negative row.
9. RLS is enabled on every table and `npm run test:rls` must pass before any deploy.
10. No `any`. No unused exports. No dead code left behind.

## Roles

`admin`, `accountant`, `receptionist`, `activity_staff`. Permissions matrix: build
plan §8 (moves to `docs/ARCHITECTURE.md` in WP-21). `activity_staff` must never be
able to read prices, totals, commissions or customer contact details.

## UX principles

The booking form is used by someone standing at a desk with a customer waiting.
Speed and keyboard operability beat visual polish. Target: a typical booking in
under 45 seconds, keyboard only. No spinner over 400ms. Nothing typed is ever lost
on an error. Minimum 44px touch targets (`min-h-11`). No hover-only affordances.

## Adjustments to the build plan (from the existing prototype)

- **Brand, not neutral.** The UI uses AquaSail's brand tokens from the prototype
  (brand blue `#2c3792` for primary actions, cyan `#00adef` accent, Jost display
  - Source Sans 3 body), defined in `src/app/globals.css` under shadcn variable
    names. Light theme only — the brand defines no dark theme.
- **shadcn components are hand-written.** The shadcn registry (ui.shadcn.com) is
  unreachable from the dev environment, so `npx shadcn add` fails. Components in
  `src/components/ui/` follow the shadcn source and API exactly (Radix primitive +
  `cva` + `cn`). To add one (dialog, select, tabs, dropdown-menu, sonner...),
  `npm i` the Radix package and write the component in the same style.
- **Catalogue and seed data** (WP-19) come from the prototype, not the PDF list:
  - Activities: CATAMARAN (Catamaran Cruise), PARASAIL, UNDERSEA (Undersea Walk),
    UNDERSEAPHOTO, TUBE, SPEEDBOAT, PRIVATEBOAT, ISLANDVISIT (Ile aux Cerfs),
    LUNCH (Beach BBQ Lunch), SNORKEL.
  - Packages: ISLANDEXP Island Explorer (bundle: catamaran + snorkel + lunch),
    SUNSET Sunset Cruise (bundle: catamaran), ADRENALINE Adrenaline Combo
    (components: parasail + tube), UNDERSEAPKG Undersea Adventure (components:
    undersea + lunch).
  - Operators: Beachcomber Hotel (net_rate, operator pays), Veranda Resorts
    (commission 20%, client pays), Sofitel Merville (commission 15%, client pays),
    Heritage Le Telfair (net_rate, client pays).
  - Prices: the walk-in and net-rate tables in `buildBasePriceRules()` in the
    prototype, including the Catamaran adult price history (1,700 → 1,800 on
    1 Sep 2026 → 1,950 on 1 Oct 2026).
- **Fleet is pulled forward from V4 into V1.** A `resources` table (boats:
  Catamaran A cap 20, Catamaran B cap 20, Cataspeed cap 12) and
  `bookings.resource_id`. Any booking whose lines include the CATAMARAN activity
  (directly or via a package) must be assigned a boat before it can be created.
  Capacity is shown and warned about ("Adding 6 more would exceed capacity"), not
  enforced — hard capacity rules stay in V4. Schema lands in WP-05; the "Assign a
  boat" wizard section in WP-15; fleet headcount vs capacity on /today in WP-17.
- **Daily register is a V1 screen** (`/register`, new WP-17b). A printable
  end-of-day sheet for one date: PAX and amount received per vessel and per
  activity, a second table per tour operator, and the day's total received
  (all methods). Attribution follows the prototype's `viewRegister()`: a boat
  booking's full value goes to its vessel; other bookings' activity lines are
  valued at their own resolved price, scaled by the booking's discount and paid
  ratios. Implement the arithmetic as a database view/function so V3's
  reconciliation reuses it.
- **Local Supabase in Codespaces**: custom Docker bridge networks are dropped by a
  legacy iptables `FORWARD DROP` policy, so `supabase start` fails at "Initialising
  schema". Fix once per Codespace (see README) or work against a cloud project.

## Database workflow (from WP-02)

Write SQL in `supabase/migrations/` → `npm run db:reset` (rebuild local DB from
scratch) → `npm run db:types` → commit. Deploy with `npm run db:push`.

The repo is linked to the cloud project (ref `zhcxfxrsmmihnnwzfvdc`, eu-west-1).
Push only after the local reset passes, and ask first: it is production.
Auth hooks cannot be set in SQL: locally `supabase/config.toml` enables
`custom_access_token_hook`; on the cloud project it is enabled by hand under
Authentication > Hooks. Policies call the helpers from `0001_identity.sql` as
`(select public.has_role(...))`, `(select public.is_admin())`.

## Commits

Conventional commits tagged with the work package, one WP per commit:
`feat(booking): WP-15 booking flow`.
