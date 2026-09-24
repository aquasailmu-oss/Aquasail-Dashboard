# Aquasail Dashboard

Watersports operations platform for AquaSail Watersports Ltd (Mauritius) — bookings, pricing, fleet tracking, and daily reconciliation.

## What's here right now

`prototype/index.html` is a standalone, interactive **UI prototype** built to show the client a tangible preview before the real build starts. It's a single self-contained HTML file (vanilla JS, no build step, no backend) — open it directly in a browser. State persists to that browser's `localStorage` only.

It covers, with realistic seeded data and a real (client-side) pricing engine — not hardcoded totals:

- **Today** — KPIs, the day's bookings, live fleet headcounts (Catamaran A / B / Cataspeed vs. capacity), and per-activity entitlement counts.
- **New booking** — the client → source → package → participants → boat assignment → payment wizard, including duplicate-client detection, the operator "do not collect" banner, and discount caps.
- **Booking detail & printable ticket** — line items, entitlements, the payment-correction pattern (never delete, only correct), and an audit trail.
- **Pricing** — the effective-dated pricing matrix (prices are never overwritten, only closed and re-opened from an effective date) with per-item history.
- **Daily register** — a printable, date-scoped end-of-day sheet (Activity / PAX / Amount received) broken down by vessel, individual activity, and tour operator.

## What's not here yet

The actual application — Next.js (App Router) + Supabase, with real auth, RLS, migrations, and persistence — hasn't been started. That build follows the phased plan (V0 foundation → V1 core booking system → V2 ticketing → V3 accounting → V4 capacity/analytics) once the Supabase project and this repo are wired up for real development.
