# Backups and recovery

Three layers, because a backup that has never been restored is only a hope.

| Layer                  | Covers                                                   | Where                                       |
| ---------------------- | -------------------------------------------------------- | ------------------------------------------- |
| Point-in-time recovery | "someone ran a bad update an hour ago"                   | Supabase (plan setting)                     |
| Nightly encrypted dump | deleted or locked project, lost account, billing failure | GitHub Actions artifacts (outside Supabase) |
| Rehearsed restore      | proves the other two work                                | this document                               |

## 1. Point-in-time recovery (PITR)

Supabase dashboard → Project Settings → Add-ons → Point in Time Recovery.
The Free plan has no PITR and the Pro plan keeps 7 days of daily backups; PITR
is an add-on on Pro. **Record here what is enabled:**

- Plan: _(fill in)_ · PITR: _(on/off)_ · Retention: _(days)_ · Checked on: _(date)_

## 2. Nightly encrypted dump

`.github/workflows/backup.yml` runs at 00:30 Mauritius time (and on demand:
Actions → Nightly backup → Run workflow). It dumps the **data** of the
`public` (business data, audit log), `auth` (logins) and `storage` (file
records) schemas with PostgreSQL 17's `pg_dump`, compresses it, encrypts it
with AES-256 using a passphrase, and keeps it as a workflow artifact for
**30 days**. The schema itself is `supabase/migrations/` in this repository.

Set two repository secrets (Settings → Secrets and variables → Actions):

- `SUPABASE_DB_URL`: Supabase → Connect → **Session pooler** URI, with the
  database password filled in.
- `BACKUP_PASSPHRASE`: a long random passphrase. Keep a copy offline (a
  password manager owned by the business). Without it the backups are useless.

The logo in the `branding` storage bucket is not in the dump; keep the
original file. For longer retention, add a step copying the encrypted file to
S3 or Cloudflare R2.

## 3. Restoring

Into a **scratch** project first (never straight over production):

```bash
# 1. The schema: link the scratch project and apply the migrations
npx supabase link --project-ref <scratch-ref>
npx supabase db push

# 2. The data: download the artifact from the Actions run, then
gpg --decrypt aquasail-data-YYYY-MM-DD.sql.gz.gpg | gunzip > data.sql
psql "<scratch Session pooler URI>" --single-transaction -v ON_ERROR_STOP=1 \
  -c "set session_replication_role = replica" -f data.sql
```

`session_replication_role = replica` pauses triggers during the load, so the
audit log is restored exactly and not rewritten, and the circular reference
between payments and their corrections loads in any order.

Then configure the scratch project's auth by hand (README, "Cloud project
setup"), point a local app at it (`.env.local`) and check: sign in, open
Today and Bookings, and compare the booking count and the month's charged total
with production.

To make the scratch project the new production: point Vercel's environment
variables at it and redeploy.

## Restore rehearsals

Repeat every quarter and record it here.

| Date        | Source                      | Target                                                    | Result                                                                                                                                                                                                                                |
| ----------- | --------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 25 Sep 2026 | local stack, full demo data | the same stack wiped to an empty schema (migrations only) | Identical after restore: 66 bookings, 52 payments, 20 clients, 48 prices, 586 audit rows, 4 users, Rs 408,390 charged; demo sign-in works; no audit rows added. Found and fixed: `storage.migrations` must be excluded from the dump. |
| _(to do)_   | production nightly artifact | scratch Supabase project                                  |                                                                                                                                                                                                                                       |
