-- Supabase Cron invokes the existing authenticated Vercel worker every five
-- minutes. The endpoint URL and bearer secret are stored in Supabase Vault.
create schema if not exists extensions;
create schema if not exists vault;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

select vault.create_secret(
  'https://aqusail-public-website-vq14.vercel.app/api/integrations/google-sheets/sync',
  'google_sheets_sync_url',
  'Production booking sheet sync endpoint'
);

select cron.schedule(
  'aquasail-google-sheets-sync',
  '*/5 * * * *',
  $$
    select case
      when secrets.endpoint is not null and secrets.token is not null then
        net.http_get(
          url := secrets.endpoint,
          headers := jsonb_build_object('Authorization', 'Bearer ' || secrets.token)
        )
      else null
    end
    from (
      select
        (select decrypted_secret from vault.decrypted_secrets where name = 'google_sheets_sync_url') as endpoint,
        (select decrypted_secret from vault.decrypted_secrets where name = 'google_sheets_sync_cron_secret') as token
    ) as secrets;
  $$
);
