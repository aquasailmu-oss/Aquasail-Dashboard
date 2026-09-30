-- WP-29: pgTAP tests for day_manifest() and sync_queued_item().

begin;
create extension if not exists pgtap;
select plan(14);

-- ---- fixtures ----------------------------------------------------------------

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
values
  ('aaaa0029-0000-0000-0000-000000000001', 'manifest-staff@test.local',
   '{"provider":"email","providers":["email"]}',
   '{"first_name":"Mani","last_name":"Staff","role":"activity_staff"}'),
  ('aaaa0029-0000-0000-0000-000000000002', 'manifest-super@test.local',
   '{"provider":"email","providers":["email"]}',
   '{"first_name":"Super","last_name":"Visor","role":"activity_supervisor"}'),
  ('aaaa0029-0000-0000-0000-000000000003', 'manifest-acc@test.local',
   '{"provider":"email","providers":["email"]}',
   '{"first_name":"Acc","last_name":"Ountant","role":"accountant"}');

insert into public.locations (id, code, name, location_type)
values ('bbbb0029-0000-0000-0000-000000000001', 'island', 'Test Island', 'island');

insert into public.staff_devices (id, label, location_id, device_secret_hash, registered_by)
values (
  'cccc0029-0000-0000-0000-000000000001', 'Manifest tablet',
  'bbbb0029-0000-0000-0000-000000000001',
  encode(digest('test-secret-29', 'sha256'), 'hex'),
  'aaaa0029-0000-0000-0000-000000000002'
);

insert into public.clients (id, first_name, last_name)
values ('dddd0029-0000-0000-0000-000000000001', 'John', 'Doe');

-- Ensure LUNCH activity exists
do $$ begin
  if not exists (select 1 from public.activities where code = 'LUNCH') then
    insert into public.activities (id, code, name, is_active)
    values ('eeee0029-0000-0000-0000-000000000001', 'LUNCH', 'Beach BBQ Lunch', true);
  end if;
end $$;

-- Today's confirmed booking (walk-in, no operator)
insert into public.bookings (id, reference, client_id, source_type, service_date, status,
  retail_total_cents, charged_total_cents, discount_total_cents,
  departure_time, meeting_point)
values (
  'ffff0029-0000-0000-0000-000000000001', 'WS-20260930-9901',
  'dddd0029-0000-0000-0000-000000000001', 'walk_in',
  (now() at time zone 'Indian/Mauritius')::date, 'confirmed',
  680000, 680000, 0,
  '08:30', 'Jetty 1'
);

-- PAX
insert into public.booking_participants (booking_id, participant_type, count)
values ('ffff0029-0000-0000-0000-000000000001', 'adult', 4);

-- Entitlement
insert into public.booking_activities (id, booking_id, activity_id, quantity)
values (
  'ffff0029-0000-0000-0000-000000000002',
  'ffff0029-0000-0000-0000-000000000001',
  (select id from public.activities where code = 'LUNCH'),
  4
);

-- Ticket with known token (token_hash is a generated column)
insert into public.tickets (id, booking_id, token)
values (
  'ffff0029-0000-0000-0000-000000000003',
  'ffff0029-0000-0000-0000-000000000001',
  'aabbccdd00112233aabbccdd00112233'
);

-- Yesterday's booking (should NOT appear)
insert into public.bookings (id, reference, client_id, source_type, service_date, status,
  retail_total_cents, charged_total_cents, discount_total_cents)
values (
  'ffff0029-0000-0000-0000-000000000004', 'WS-20260929-9902',
  'dddd0029-0000-0000-0000-000000000001', 'walk_in',
  (now() at time zone 'Indian/Mauritius')::date - 1, 'confirmed',
  340000, 340000, 0
);

-- ---- helpers ------------------------------------------------------------------

create function pg_temp.manifest_as(p_user_id uuid)
returns jsonb language plpgsql as $fn$
declare v jsonb;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  select public.day_manifest('cccc0029-0000-0000-0000-000000000001', 'test-secret-29') into v;
  return v;
end; $fn$;

create function pg_temp.sync_as(p_user_id uuid, p_type text, p_payload jsonb)
returns jsonb language plpgsql as $fn$
declare v jsonb;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  select public.sync_queued_item(
    'cccc0029-0000-0000-0000-000000000001',
    'test-secret-29',
    p_type,
    p_payload
  ) into v;
  return v;
end; $fn$;

-- ---- helpers to find our booking in the manifest array -----------------------

create function pg_temp.our_booking(p_manifest jsonb)
returns jsonb language sql as $fn$
  select e.value
  from jsonb_array_elements(p_manifest->'bookings') e
  where e.value->>'booking_id' = 'ffff0029-0000-0000-0000-000000000001';
$fn$;

-- ---- manifest tests -----------------------------------------------------------

-- 1. Staff gets today's bookings (at least our fixture)
select ok(
  pg_temp.our_booking(pg_temp.manifest_as('aaaa0029-0000-0000-0000-000000000001')) is not null,
  'staff gets today''s bookings including our fixture'
);

-- 2. Manifest carries token_hash (sha256 of our known token)
select ok(
  (pg_temp.our_booking(pg_temp.manifest_as('aaaa0029-0000-0000-0000-000000000001'))->>'token_hash')
    = encode(digest('aabbccdd00112233aabbccdd00112233', 'sha256'), 'hex'),
  'manifest carries token_hash'
);

-- 3. Manifest never has the actual token
select ok(
  position('aabbccdd00112233aabbccdd00112233' in
    (pg_temp.manifest_as('aaaa0029-0000-0000-0000-000000000001'))::text) = 0,
  'manifest never carries the actual token'
);

-- 4. Manifest has the right reference
select is(
  pg_temp.our_booking(pg_temp.manifest_as('aaaa0029-0000-0000-0000-000000000001'))->>'reference',
  'WS-20260930-9901',
  'manifest carries the reference'
);

-- 5. Entitlement quantity correct
select is(
  (pg_temp.our_booking(pg_temp.manifest_as('aaaa0029-0000-0000-0000-000000000001'))->'entitlements'->0->>'quantity')::int,
  4,
  'entitlement quantity is 4'
);

-- 6. No redemptions yet
select is(
  (pg_temp.our_booking(pg_temp.manifest_as('aaaa0029-0000-0000-0000-000000000001'))->'entitlements'->0->>'already_redeemed')::int,
  0,
  'no redemptions yet'
);

-- 7. Yesterday's booking is not in the manifest (filter by our yesterday fixture)
select ok(
  not exists (
    select 1 from jsonb_array_elements(pg_temp.manifest_as('aaaa0029-0000-0000-0000-000000000001')->'bookings') e
    where e.value->>'booking_id' = 'ffff0029-0000-0000-0000-000000000004'
  ),
  'yesterday''s booking is not in the manifest'
);

-- 8. Has generated_at
select ok(
  (pg_temp.manifest_as('aaaa0029-0000-0000-0000-000000000001')->>'generated_at') is not null,
  'manifest has generated_at'
);

-- 9. Business date is today
select is(
  (pg_temp.manifest_as('aaaa0029-0000-0000-0000-000000000001')->>'business_date'),
  (now() at time zone 'Indian/Mauritius')::date::text,
  'manifest business_date is today'
);

-- 10. Accountant denied
select throws_ok(
  $$select pg_temp.manifest_as('aaaa0029-0000-0000-0000-000000000003')$$,
  'P0001',
  'Your role cannot use the island app.',
  'accountant cannot fetch the manifest'
);

-- ---- sync tests ---------------------------------------------------------------

-- 11. Sync check-in
select is(
  pg_temp.sync_as(
    'aaaa0029-0000-0000-0000-000000000001',
    'check_in',
    jsonb_build_object('booking_id', 'ffff0029-0000-0000-0000-000000000001',
                       'client_uuid', extensions.gen_random_uuid())
  )->>'result',
  'applied',
  'sync check-in returns applied'
);

-- 12. Second check-in already_applied
select is(
  pg_temp.sync_as(
    'aaaa0029-0000-0000-0000-000000000001',
    'check_in',
    jsonb_build_object('booking_id', 'ffff0029-0000-0000-0000-000000000001',
                       'client_uuid', extensions.gen_random_uuid())
  )->>'result',
  'already_applied',
  'second check-in is already_applied'
);

-- 13. Sync redemption
select is(
  pg_temp.sync_as(
    'aaaa0029-0000-0000-0000-000000000001',
    'redeem',
    jsonb_build_object('booking_activity_id', 'ffff0029-0000-0000-0000-000000000002',
                       'quantity', 3,
                       'client_uuid', extensions.gen_random_uuid(),
                       'occurred_at_device', now() - interval '10 minutes')
  )->>'result',
  'applied',
  'sync redemption returns applied'
);

-- 14. Over-redemption from queue is flagged
select is(
  pg_temp.sync_as(
    'aaaa0029-0000-0000-0000-000000000001',
    'redeem',
    jsonb_build_object('booking_activity_id', 'ffff0029-0000-0000-0000-000000000002',
                       'quantity', 4,
                       'client_uuid', extensions.gen_random_uuid(),
                       'occurred_at_device', now() - interval '5 minutes')
  )->>'result',
  'over_redemption',
  'queued over-redemption is flagged not rejected'
);

select * from finish();
rollback;
