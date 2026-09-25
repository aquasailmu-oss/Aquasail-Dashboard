# AquaSail Ops: architecture

The design record for whoever maintains this next. Start here before
"simplifying" anything: most choices below exist because the simpler version
loses money or history. Conventions for day-to-day work are in `CLAUDE.md`.

## Shape of the system

```
Browser (reception PC, tablet)            Vercel: Next.js 15 App Router
  forms, no database access    ───────►   Server Components  (pages: read)
                                          Server Actions     (every write, Zod + authorize + Result)
                                          Route Handlers     (Excel export, ticket PDF, /api/health)
                                                │  user's own JWT: RLS applies
                                                ▼
                                          Supabase Postgres  (source of truth)
                                          Auth · Storage (logo)
```

- **No API layer of our own and no ORM.** Pages and actions use the Supabase
  client bound to the signed-in user (`src/lib/supabase/server.ts`), so Row
  Level Security is the floor under every query. Types are generated
  (`src/lib/database.types.ts`).
- **The service-role key** (`src/lib/supabase/admin.ts`) is used only by the
  admin's invite action. It throws if bundled for the browser.
- **Money and atomic writes live in Postgres functions.** Anything that must
  be all-or-nothing or must price something is a `security definer` function
  that checks the caller's role itself.

## Data model

| Table                            | Holds                                                           | Notes                                                    |
| -------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------- |
| `profiles`                       | one row per auth user: name, role, active                       | role changes and deactivation apply on the next request  |
| `clients`                        | name, phone (E.164, unique), email, country, notes              | trigram `search_text` for "existing customer found"      |
| `activities`                     | the atomic things sold (CATAMARAN, PARASAIL…)                   | code immutable; deactivated, never deleted               |
| `packages`, `package_activities` | bundles of activities                                           | `bundle` (own price) or `components` (sum of activities) |
| `tour_operators`                 | settlement model (net rate / commission / none) and who pays    | the two questions are independent                        |
| `price_rules`                    | one price for one thing, audience, participant type, date range | effective-dated; see below                               |
| `resources`                      | boats with capacity                                             | CATAMARAN bookings must have one                         |
| `bookings`                       | header with the five money totals and payer                     | cancelled, never deleted                                 |
| `booking_items`                  | priced lines with the **price snapshot**                        | retail, charged, net, commission per line                |
| `booking_participants`           | counts per participant type                                     |                                                          |
| `booking_activities`             | entitlements expanded at creation                               | V2 redeems these; history never re-interpreted           |
| `payments`                       | append-only; corrections are negative rows                      | `received_at` and `recorded_by` are set by the server    |
| `tickets`                        | random 16-byte token per booking, print count                   | the token is the future QR payload                       |
| `booking_sequences`              | per-day counter for `WS-YYYYMMDD-NNNN`                          |                                                          |
| `app_settings`                   | key/value settings                                              | typed accessors with defaults                            |
| `audit_logs`                     | old/new JSON of every change with actor                         | written by trigger; immutable even for admins            |

Views: `client_summaries` (booking count, last visit) and `booking_register`
(people, paid, balance, payment status, what was booked). Both are
`security_invoker`, so the caller's RLS applies. Today, the booking list and
the Excel export all read `booking_register`, which is why their totals tie.

## Effective-dated pricing (why prices are never updated)

A booking must still read Rs 1,700 in December if that was the price in June,
and an accountant must be able to see what the price was on any date. So:

- `price_rules` rows are never updated in place. `set_price()` (admin only)
  **closes** the open rule the day the new one starts and inserts the new
  one. There are no insert/update grants on the table at all.
- An exclusion constraint (`btree_gist` over item, audience, operator,
  participant type and `daterange`) makes two overlapping prices for the same
  thing **impossible to store**.
- A price cannot start in the past. A price scheduled for the future that no
  booking falls under can be withdrawn (`withdraw_scheduled_price()`), and the
  previous price is extended over the gap.
- Bookings copy the figures onto `booking_items` (the snapshot) and keep
  `price_rule_id`, so a later price change never alters an existing booking.

## The pricing engine: `build_quote(input)`

Lives in Postgres (`supabase/migrations/0011_pricing_engine.sql`), not in
TypeScript: reception may not read `price_rules`, and the database prices
every booking itself. `src/lib/pricing/` is a typed wrapper.

**Input:** `{service_date, operator_id?, lines: [{target_type, target_id,
participant_type, quantity}], discount?: {type: amount|percent, value, reason}}`
(amount in cents, percent in basis points: 1000 = 10%).

**Rules:**

1. Resolution: the operator's own rule for the service date, else the
   walk-in rule, else an error naming the item, participant type and date.
   A missing price is never zero.
2. A `bundle` package resolves its own rule; a `components` package sums its
   non-optional activities × quantity per participant.
3. Settlement: **net rate** → charged = net (retail with a warning when no net
   price exists); **commission** → charged = retail, commission =
   round(retail × rate), the rule's rate over the operator's default;
   **none / walk-in** → charged = retail. Half-up on integer cents, per line.
4. Discounts need a reason; a receptionist is capped by
   `max_discount_percent_receptionist`; the total discount is spread across
   lines by largest remainder, so the lines add up exactly.
5. `payer` comes from the operator (walk-ins pay at reception).

**Output:** every line with retail, charged, net, commission and the rule id,
plus the five totals, the payer and warnings. `getQuote` strips net and
commission before a quote reaches a receptionist.

**Writes.** `create_booking(payload)` and `amend_booking(id, payload)` call
`build_quote` themselves and write its figures. A payload carries only
choices and the total the user was shown; if the engine now disagrees, the
write is refused ("Prices changed while you were booking"). Amounts put into a
payload by hand are ignored. Idempotency keys make a double submit return the
same booking.

## Operators: two separate questions

1. **How is our price worked out?** `settlement_model`: net rate, commission
   or none. This decides revenue, net and commission.
2. **Who hands us the money?** `payer`: the customer at reception, or the
   operator later. Operator-pays bookings are unpaid by design, reception sees
   "DO NOT COLLECT PAYMENT", and the total is a receivable.

Every line records retail, charged, net and commission, so V3's operator
statements can be produced from V1's history without re-entering anything.

## Roles and permissions

Roles live in `profiles.role` and are copied into the JWT (`user_role`) by
`custom_access_token_hook`. Policies call `auth_role()`, which reads the
**live profile**, so a deactivation takes effect immediately rather than when
the token expires. An inactive user is denied everywhere.

| Data                 | admin                          | accountant  | receptionist                            | activity_staff            |
| -------------------- | ------------------------------ | ----------- | --------------------------------------- | ------------------------- |
| clients              | all                            | read        | read, create, update                    | none                      |
| activities, packages | all                            | read        | read                                    | read (no prices anywhere) |
| tour operators       | all                            | read        | read                                    | none                      |
| price rules          | read; change via `set_price()` | read        | none (quotes only)                      | none                      |
| bookings and lines   | all, any date                  | read        | create; amend or cancel today and later | none                      |
| payments             | read, insert                   | read        | read, insert (never update or delete)   | none                      |
| audit log            | read                           | read        | none                                    | none                      |
| settings             | all                            | read        | read                                    | read                      |
| users                | all                            | own profile | own profile                             | own profile               |

In the UI, reception never sees operator net prices or commissions. Nobody can
delete a booking, payment, client or catalogue row. `npm run test:rls` attacks
these rules through the public API with real signed-in users.

## Deliberate exceptions to "nothing is deleted"

All are audited, so the rows remain readable in the audit log:

- `save_package()` replaces a package's activity links (composition, not a
  catalogue row; bookings keep their own expanded entitlements);
- `withdraw_scheduled_price()` removes a price that has not started and
  that no booking falls under;
- `amend_booking()` deletes the lines an amendment removes.

## Audit

`audit_trigger()` writes old/new JSON, the actor and the role for every
change to the money, catalogue, settings and user tables. `audit_logs` has no
update or delete grant for anyone, and a trigger blocks update, delete and
truncate even for the table owner. The viewer (`src/lib/audit.ts`) turns rows
into sentences and field-by-field diffs.

## Daily register

`daily_register(date)` (migration 0016) follows the approved prototype: a
boat booking's value goes to its vessel as far as it is paid; other bookings'
activities are valued at their own price, scaled by the booking's discount and
paid ratios; operators get a second table; total received is every payment
on that date's bookings. V3's reconciliation should reuse this function.

## Time and money

- Money is integer cents everywhere (`bigint`, branded `Cents`), formatted
  only by `formatRs()`.
- Business dates are Mauritius dates (`businessDate()`, `today_mauritius()`).
  Timestamps are `timestamptz`; "today" in timestamp filters uses
  `businessDayBounds()`.

## Testing

| Layer      | Command            | What it proves                                                                                                      |
| ---------- | ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Unit       | `npm test`         | money, dates, phone, percentages, audit formatting                                                                  |
| Database   | `npm run test:db`  | pgTAP: pricing engine rules, constraints, booking functions, register arithmetic                                    |
| RLS        | `npm run test:rls` | each role attacked through the public API                                                                           |
| End-to-end | `npm run test:e2e` | Playwright: the plan's booking, operator, pricing, discount, amend/cancel, idempotency, export and layout scenarios |

CI (`.github/workflows/ci.yml`) runs all four against a local Supabase built
from the migrations. Releases: [RELEASE.md](RELEASE.md). Backups:
[BACKUP.md](BACKUP.md).
