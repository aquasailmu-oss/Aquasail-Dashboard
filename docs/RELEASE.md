# Releasing AquaSail Ops

Production is the Supabase project `zhcxfxrsmmihnnwzfvdc` (eu-west-1) and the
Vercel project for this repository. Real money: follow the order below.

## Rules

1. **CI must be green** on the pull request: format, types, lint, unit tests,
   pgTAP database tests, the RLS attack suite and the Playwright end-to-end
   tests. Make `CI / checks` a required status check on `main`
   (GitHub → Settings → Branches → Branch protection).
2. **Migrate first, then deploy the app.** A migration must be
   backward-compatible with the app that is already running, because for a
   few minutes the new schema serves the old code:
   - add a column or function before the code that uses it; remove things one
     release after the code stopped using them;
   - never rename in place: add the new name, move the code, drop the old later;
   - replacing a function (`create or replace`) must keep its arguments working.
3. **Not during opening hours on a busy day.** Reception peaks in the morning:
   release late afternoon or on a closed day.

## Steps

```bash
git checkout main && git pull
npx supabase migration list          # what production has vs the repo
npx supabase db push --dry-run       # what will be applied
npx supabase db push                 # apply (asks to confirm)
```

Then merge / let Vercel deploy `main`, and check:

1. `https://<app>/api/health` returns `"status": "ok"` and the expected
   `schema_version` (the newest file in `supabase/migrations/`).
2. Sign in as a receptionist, create a booking for a test client, print the
   ticket, then cancel it with the reason "Release check".

If a migration also changes an auth setting that SQL cannot reach (hooks,
email templates, URLs), apply it in the dashboard as listed in the README.

## Rolling back

- **App**: in Vercel, promote the previous deployment (Deployments → ⋯ →
  Promote to Production). Because migrations are backward-compatible, the
  previous app works on the new schema.
- **Schema**: never edit or delete an applied migration. Write a new migration
  that reverses the change, test it with `npm run db:reset` locally, and push
  it like any other.
- **Data**: point-in-time recovery or the nightly backup, see
  [BACKUP.md](BACKUP.md).

## Vercel settings

| Variable                        | Environments        | Notes                                      |
| ------------------------------- | ------------------- | ------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | Production, Preview | `https://zhcxfxrsmmihnnwzfvdc.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production, Preview | the anon (publishable) key                 |
| `SUPABASE_SERVICE_ROLE_KEY`     | Production only     | secret; **never** prefixed `NEXT_PUBLIC_`  |

Preview deployments must not use production data: point them at a separate
staging project, or leave `SUPABASE_SERVICE_ROLE_KEY` unset there. Turn on
Vercel Deployment Protection for previews.
