-- WP-27 (V2): device registration, device_info() and manual reference entry.
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000027a1', 'admin@t27.local', '{"role":"admin","full_name":"Ada"}'),
  ('00000000-0000-0000-0000-0000000027d4', 'staff@t27.local', '{"role":"activity_staff","full_name":"Sam"}'),
  ('00000000-0000-0000-0000-0000000027e5', 'sup@t27.local', '{"role":"activity_supervisor","full_name":"Sue"}');
insert into public.clients (id, first_name, last_name) values ('00000000-0000-0000-0000-00000027c001', 'Jo', 'Smith');
insert into public.bookings (id, reference, client_id, source_type, service_date) values
  ('00000000-0000-0000-0000-00000027b001', 'WS-' || to_char(public.today_mauritius(), 'YYYYMMDD') || '-9042',
   '00000000-0000-0000-0000-00000027c001', 'walk_in', public.today_mauritius()),
  ('00000000-0000-0000-0000-00000027b002', 'WS-20260101-9043', '00000000-0000-0000-0000-00000027c001', 'walk_in', '2026-01-01');
insert into public.tickets (booking_id, token, revoked_at, revoke_reason, issued_at) values
  ('00000000-0000-0000-0000-00000027b001', 'tok27-old', now(), 'Lost phone', now() - interval '1 hour');
insert into public.tickets (booking_id, token) values
  ('00000000-0000-0000-0000-00000027b001', 'tok27-live'),
  ('00000000-0000-0000-0000-00000027b002', 'tok27-jan');

create temp table dev (device_id uuid, secret text);
grant all on dev to authenticated;
create function pg_temp.device(p_id uuid) returns public.staff_devices language sql security definer as $$
  select * from public.staff_devices where id = p_id
$$;

set local role authenticated;

-- Registration
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000027d4","role":"authenticated"}', true);
select throws_ok($$select public.register_device('Rogue', (select id from public.locations where code = 'ISLAND'))$$,
  'P0001', 'Only a supervisor or an admin can register a device.', 'island staff cannot register a device');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000027e5","role":"authenticated"}', true);
insert into dev select (r ->> 'device_id')::uuid, r ->> 'secret'
from public.register_device('  T27 tablet ', (select id from public.locations where code = 'ISLAND')) r;
select matches((select secret from dev), '^[0-9a-f]{64}$', 'a supervisor registers a device and gets a 32-byte secret, once');
select results_eq(
  $$select d.label, d.device_secret_hash, d.registered_by from dev, pg_temp.device(dev.device_id) d$$,
  $$select 'T27 tablet', encode(extensions.digest(secret, 'sha256'), 'hex'), '00000000-0000-0000-0000-0000000027e5'::uuid from dev$$,
  'only the secret''s hash is stored, with the trimmed label and who registered it');
select throws_ok($$select public.register_device('t27 TABLET', (select id from public.locations where code = 'ISLAND'))$$,
  'P0001', 'A device called "t27 TABLET" is already registered. Choose another name.', 'two active devices cannot share a name');
select throws_ok($$select public.register_device('T27 other', null)$$,
  'P0001', 'Choose where this device is used.', 'a device belongs to a location');

-- device_info
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000027d4","role":"authenticated"}', true);
select results_eq(
  $$select r ->> 'label', r ->> 'location_name' from dev, public.device_info(dev.device_id, dev.secret) r$$,
  $$values ('T27 tablet', 'Ile aux Cerfs')$$, 'the device reports its name and place');
select throws_ok($$select public.device_info((select device_id from dev), 'wrong')$$,
  'P0001', 'This device is not recognised. Ask a supervisor to register it again.', 'a wrong secret is refused');

-- Manual reference entry
create function pg_temp.ref(p text) returns jsonb language sql as $$
  select public.scan_reference(p, (select device_id from dev), (select secret from dev))
$$;
select results_eq($$select r ->> 'verdict', r ->> 'reference' from pg_temp.ref('9042') r$$,
  $$values ('VALID', 'WS-' || to_char(public.today_mauritius(), 'YYYYMMDD') || '-9042')$$,
  'the digits alone find today''s booking, from its live ticket, not the replaced one');
select is(pg_temp.ref(' 9042 ') ->> 'verdict', 'VALID', 'spaces are ignored');
select is(pg_temp.ref('ws-' || to_char(public.today_mauritius(), 'YYYYMMDD') || '-9042') ->> 'verdict', 'VALID',
  'the full reference works in lower case');
select is(pg_temp.ref('WS' || to_char(public.today_mauritius(), 'YYYYMMDD') || '9042') ->> 'verdict', 'VALID',
  'and without its dashes');
select is(pg_temp.ref('WS-20260101-9043') ->> 'verdict', 'WRONG_DATE', 'another day''s full reference says WRONG_DATE');
select is(pg_temp.ref('9999'), '{"verdict":"NOT_FOUND"}'::jsonb, 'an unknown reference is NOT_FOUND');
select is(pg_temp.ref('hello'), '{"verdict":"NOT_FOUND"}'::jsonb, 'nonsense is NOT_FOUND, not an error');
select is(public.scan_ticket('tok27-live', (select device_id from dev), (select secret from dev)),
  pg_temp.ref('9042'), 'a typed reference answers exactly as scanning the ticket does');

select * from finish();
rollback;
