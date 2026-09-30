-- WP-30: pgTAP tests for review_queue(), device_list(), deactivate_device(),
-- shift_summary().

begin;
create extension if not exists pgtap;
select plan(13);

-- ---- fixtures ----------------------------------------------------------------

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
values
  ('aaaa0030-0000-0000-0000-000000000001', 'sup30-staff@test.local',
   '{"provider":"email","providers":["email"]}',
   '{"first_name":"Staff","last_name":"Person","role":"activity_staff"}'),
  ('aaaa0030-0000-0000-0000-000000000002', 'sup30-super@test.local',
   '{"provider":"email","providers":["email"]}',
   '{"first_name":"Super","last_name":"Visor","role":"activity_supervisor"}'),
  ('aaaa0030-0000-0000-0000-000000000003', 'sup30-recep@test.local',
   '{"provider":"email","providers":["email"]}',
   '{"first_name":"Recep","last_name":"Tion","role":"receptionist"}');

insert into public.locations (id, code, name, location_type)
values ('bbbb0030-0000-0000-0000-000000000001', 'isl30', 'Test Island 30', 'island');

insert into public.staff_devices (id, label, location_id, device_secret_hash, registered_by)
values
  ('cccc0030-0000-0000-0000-000000000001', 'Supervisor tablet',
   'bbbb0030-0000-0000-0000-000000000001',
   encode(digest('test-secret-30', 'sha256'), 'hex'),
   'aaaa0030-0000-0000-0000-000000000002'),
  ('cccc0030-0000-0000-0000-000000000002', 'Staff tablet 30',
   'bbbb0030-0000-0000-0000-000000000001',
   encode(digest('test-secret-30b', 'sha256'), 'hex'),
   'aaaa0030-0000-0000-0000-000000000002');

insert into public.clients (id, first_name, last_name)
values ('dddd0030-0000-0000-0000-000000000001', 'Jane', 'ReviewTest');

do $$ begin
  if not exists (select 1 from public.activities where code = 'LUNCH') then
    insert into public.activities (id, code, name, is_active)
    values ('eeee0030-0000-0000-0000-000000000001', 'LUNCH', 'Beach BBQ Lunch', true);
  end if;
end $$;

-- A confirmed booking with a 4-lunch entitlement
insert into public.bookings (id, reference, client_id, source_type, service_date, status,
  retail_total_cents, charged_total_cents, discount_total_cents)
values (
  'ffff0030-0000-0000-0000-000000000001', 'WS-20260930-3001',
  'dddd0030-0000-0000-0000-000000000001', 'walk_in',
  (now() at time zone 'Indian/Mauritius')::date, 'confirmed',
  680000, 680000, 0
);

insert into public.booking_participants (booking_id, participant_type, count)
values ('ffff0030-0000-0000-0000-000000000001', 'adult', 4);

insert into public.booking_activities (id, booking_id, activity_id, quantity)
values (
  'ffff0030-0000-0000-0000-000000000002',
  'ffff0030-0000-0000-0000-000000000001',
  (select id from public.activities where code = 'LUNCH'),
  4
);

insert into public.tickets (id, booking_id, token)
values (
  'ffff0030-0000-0000-0000-000000000003',
  'ffff0030-0000-0000-0000-000000000001',
  'aa30ccdd00112233aa30ccdd00112233'
);

-- ---- helpers ------------------------------------------------------------------

create function pg_temp.as_supervisor(p_fn text)
returns jsonb language plpgsql as $fn$
declare v jsonb;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', 'aaaa0030-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
  execute p_fn into v;
  return v;
end; $fn$;

create function pg_temp.as_staff(p_fn text)
returns jsonb language plpgsql as $fn$
declare v jsonb;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', 'aaaa0030-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
  execute p_fn into v;
  return v;
end; $fn$;

create function pg_temp.as_recep(p_fn text)
returns jsonb language plpgsql as $fn$
declare v jsonb;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', 'aaaa0030-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
  execute p_fn into v;
  return v;
end; $fn$;

-- ---- review_queue tests -------------------------------------------------------

-- 1. Empty queue when no flagged items
select is(
  jsonb_array_length(pg_temp.as_supervisor(
    $q$select public.review_queue('cccc0030-0000-0000-0000-000000000001', 'test-secret-30')$q$
  )),
  0,
  'Review queue is empty when no flagged items'
);

-- 2. Create an over-redemption via redeem_activity with from_queue (redeem 5 out of 4)
select pg_temp.as_supervisor(
  $q$select public.redeem_activity(
    'ffff0030-0000-0000-0000-000000000002', 5, 'aaaa0030-1111-0000-0000-000000000001',
    null, 'cccc0030-0000-0000-0000-000000000001', 'test-secret-30',
    null, null, true
  )$q$
);

-- 3. Queue now has 1 item
select is(
  jsonb_array_length(pg_temp.as_supervisor(
    $q$select public.review_queue('cccc0030-0000-0000-0000-000000000001', 'test-secret-30')$q$
  )),
  1,
  'Review queue has 1 item after over-redemption'
);

-- 4. Queue item has expected fields
select ok(
  (pg_temp.as_supervisor(
    $q$select public.review_queue('cccc0030-0000-0000-0000-000000000001', 'test-secret-30')$q$
  ))->0 ? 'redemption_id'
  and (pg_temp.as_supervisor(
    $q$select public.review_queue('cccc0030-0000-0000-0000-000000000001', 'test-secret-30')$q$
  ))->0 ? 'is_over_redemption',
  'Review queue item has expected keys'
);

-- 5. Receptionist cannot see queue
select throws_ok(
  $q$select pg_temp.as_recep(
    $$select public.review_queue('cccc0030-0000-0000-0000-000000000001', 'test-secret-30')$$
  )$q$,
  null,
  'Only a supervisor or an admin can see the review queue.',
  'Receptionist denied review queue'
);

-- ---- device_list tests --------------------------------------------------------

-- 6. Device list returns our devices
select ok(
  jsonb_array_length(pg_temp.as_supervisor(
    $q$select public.device_list('cccc0030-0000-0000-0000-000000000001', 'test-secret-30')$q$
  )) >= 2,
  'Device list returns at least our 2 test devices'
);

-- 7. Device entries have expected fields
select ok(
  (pg_temp.as_supervisor(
    $q$select public.device_list('cccc0030-0000-0000-0000-000000000001', 'test-secret-30')$q$
  ))->0 ? 'device_id'
  and (pg_temp.as_supervisor(
    $q$select public.device_list('cccc0030-0000-0000-0000-000000000001', 'test-secret-30')$q$
  ))->0 ? 'is_active',
  'Device list entries have expected keys'
);

-- 8. Staff cannot see device list
select throws_ok(
  $q$select pg_temp.as_staff(
    $$select public.device_list('cccc0030-0000-0000-0000-000000000002', 'test-secret-30b')$$
  )$q$,
  null,
  'Only a supervisor or an admin can manage devices.',
  'Staff denied device list'
);

-- ---- deactivate_device tests --------------------------------------------------

-- 9. Deactivate the staff tablet
select ok(
  (pg_temp.as_supervisor(
    $q$select public.deactivate_device(
      'cccc0030-0000-0000-0000-000000000002',
      'cccc0030-0000-0000-0000-000000000001', 'test-secret-30'
    )$q$
  ))->>'deactivated' = 'true',
  'Device deactivated successfully'
);

-- 10. Deactivated device is now inactive
select ok(
  not (select is_active from public.staff_devices where id = 'cccc0030-0000-0000-0000-000000000002'),
  'Deactivated device is_active = false'
);

-- 11. Cannot deactivate again
select throws_ok(
  $q$select pg_temp.as_supervisor(
    $$select public.deactivate_device(
      'cccc0030-0000-0000-0000-000000000002',
      'cccc0030-0000-0000-0000-000000000001', 'test-secret-30'
    )$$
  )$q$,
  null,
  'That device is already deactivated.',
  'Double deactivation refused'
);

-- ---- shift_summary tests ------------------------------------------------------

-- 12. Shift summary available for staff too
select ok(
  (pg_temp.as_staff(
    $q$select public.shift_summary('cccc0030-0000-0000-0000-000000000001', 'test-secret-30')$q$
  )) ? 'check_ins',
  'Staff can see shift summary (their own device)'
);

-- 13. Shift summary has expected shape
select ok(
  (pg_temp.as_supervisor(
    $q$select public.shift_summary('cccc0030-0000-0000-0000-000000000001', 'test-secret-30')$q$
  )) ? 'redemptions'
  and (pg_temp.as_supervisor(
    $q$select public.shift_summary('cccc0030-0000-0000-0000-000000000001', 'test-secret-30')$q$
  )) ? 'flagged',
  'Shift summary has redemptions and flagged keys'
);

-- 14. Receptionist cannot see shift summary
select throws_ok(
  $q$select pg_temp.as_recep(
    $$select public.shift_summary('cccc0030-0000-0000-0000-000000000001', 'test-secret-30')$$
  )$q$,
  null,
  'Your role cannot use the island app.',
  'Receptionist denied shift summary'
);

select * from finish();
rollback;
