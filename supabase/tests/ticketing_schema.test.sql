-- WP-22 (V2): the ticketing and redemption schema. Constraints, the
-- append-only redemption log, the supervisor role and the RLS boundary.
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

-- Fixtures, created as the migration owner.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000022a1', 'admin@t22.local', '{"role":"admin","full_name":"Ada"}'),
  ('00000000-0000-0000-0000-0000000022b2', 'rec@t22.local', '{"role":"receptionist","full_name":"Rita"}'),
  ('00000000-0000-0000-0000-0000000022d4', 'staff@t22.local', '{"role":"activity_staff","full_name":"Sam"}'),
  ('00000000-0000-0000-0000-0000000022e5', 'sup@t22.local', '{"role":"activity_supervisor","full_name":"Sue"}');
insert into public.activities (id, code, name) values ('00000000-0000-0000-0000-00000022ac01', 'T22_LUNCH', 'Lunch');
insert into public.clients (id, first_name, last_name) values ('00000000-0000-0000-0000-00000022c001', 'Jo', 'Smith');
insert into public.bookings (id, reference, client_id, source_type, service_date) values
  ('00000000-0000-0000-0000-00000022b001', 'WS-T22-0001', '00000000-0000-0000-0000-00000022c001', 'walk_in', public.today_mauritius());
insert into public.booking_activities (id, booking_id, activity_id, quantity) values
  ('00000000-0000-0000-0000-00000022ba01', '00000000-0000-0000-0000-00000022b001', '00000000-0000-0000-0000-00000022ac01', 4);
insert into public.tickets (booking_id) values ('00000000-0000-0000-0000-00000022b001');
insert into public.staff_devices (id, label, device_secret_hash) values
  ('00000000-0000-0000-0000-00000022de01', 'T22 tablet', 'x');
insert into public.ticket_redemptions (id, booking_id, booking_activity_id, activity_id, quantity_redeemed, client_uuid, device_id) values
  ('00000000-0000-0000-0000-00000022e001', '00000000-0000-0000-0000-00000022b001', '00000000-0000-0000-0000-00000022ba01',
   '00000000-0000-0000-0000-00000022ac01', 3, '00000000-0000-0000-0000-00000022f001', '00000000-0000-0000-0000-00000022de01');

-- The role
select is((select role::text from public.profiles where id = '00000000-0000-0000-0000-0000000022e5'), 'activity_supervisor',
  'an account created with the supervisor role gets it, not the receptionist fallback');

-- Tickets
select is((select token_hash from public.tickets where booking_id = '00000000-0000-0000-0000-00000022b001'),
  (select encode(sha256(token::bytea), 'hex') from public.tickets where booking_id = '00000000-0000-0000-0000-00000022b001'),
  'token_hash is the sha256 of the token, as the device computes it');
select throws_ok(
  $$update public.tickets set revoked_at = now() where booking_id = '00000000-0000-0000-0000-00000022b001'$$,
  '23514', null, 'a revoked ticket needs a reason');

-- Redemption constraints
select throws_ok(
  $$insert into public.ticket_redemptions (booking_id, booking_activity_id, activity_id, quantity_redeemed, client_uuid)
    values ('00000000-0000-0000-0000-00000022b001', '00000000-0000-0000-0000-00000022ba01', '00000000-0000-0000-0000-00000022ac01', 1,
            '00000000-0000-0000-0000-00000022f001')$$,
  '23505', null, 'a client_uuid is recorded once: a retried request cannot double-count');
select throws_ok(
  $$insert into public.ticket_redemptions (booking_id, booking_activity_id, activity_id, quantity_redeemed, client_uuid)
    values ('00000000-0000-0000-0000-00000022b001', '00000000-0000-0000-0000-00000022ba01', '00000000-0000-0000-0000-00000022ac01', 0, gen_random_uuid())$$,
  '23514', null, 'a redemption of zero is refused');
select throws_ok(
  $$insert into public.ticket_redemptions (booking_id, booking_activity_id, activity_id, quantity_redeemed, client_uuid, note)
    values ('00000000-0000-0000-0000-00000022b001', '00000000-0000-0000-0000-00000022ba01', '00000000-0000-0000-0000-00000022ac01', -1, gen_random_uuid(), 'x')$$,
  '23514', null, 'a negative row must be a reversal of a named redemption');
select throws_ok(
  $$insert into public.ticket_redemptions (booking_id, booking_activity_id, activity_id, quantity_redeemed, client_uuid, is_reversal, reverses_redemption_id)
    values ('00000000-0000-0000-0000-00000022b001', '00000000-0000-0000-0000-00000022ba01', '00000000-0000-0000-0000-00000022ac01', -3, gen_random_uuid(),
            true, '00000000-0000-0000-0000-00000022e001')$$,
  '23514', null, 'a reversal needs a reason');
insert into public.ticket_redemptions (booking_id, booking_activity_id, activity_id, quantity_redeemed, client_uuid, is_reversal, reverses_redemption_id, note)
values ('00000000-0000-0000-0000-00000022b001', '00000000-0000-0000-0000-00000022ba01', '00000000-0000-0000-0000-00000022ac01', -3, gen_random_uuid(),
        true, '00000000-0000-0000-0000-00000022e001', 'Mis-scan');
select throws_ok(
  $$insert into public.ticket_redemptions (booking_id, booking_activity_id, activity_id, quantity_redeemed, client_uuid, is_reversal, reverses_redemption_id, note)
    values ('00000000-0000-0000-0000-00000022b001', '00000000-0000-0000-0000-00000022ba01', '00000000-0000-0000-0000-00000022ac01', -3, gen_random_uuid(),
            true, '00000000-0000-0000-0000-00000022e001', 'Again')$$,
  '23505', null, 'a redemption is reversed at most once');

-- The log is append-only
select throws_ok(
  $$update public.ticket_redemptions set quantity_redeemed = 1 where id = '00000000-0000-0000-0000-00000022e001'$$,
  'P0001', 'A redemption cannot be changed. Reverse it instead.', 'a redemption''s quantity cannot be edited');
select throws_ok(
  $$delete from public.ticket_redemptions where id = '00000000-0000-0000-0000-00000022e001'$$,
  'P0001', 'A redemption is never deleted. Reverse it instead.', 'a redemption cannot be deleted');
select throws_ok(
  $$truncate public.ticket_redemptions cascade$$,
  'P0001', 'A redemption is never deleted. Reverse it instead.', 'the redemption log cannot be truncated');
select throws_ok(
  $$update public.ticket_redemptions set reviewed_at = now() where id = '00000000-0000-0000-0000-00000022e001'$$,
  '23514', null, 'a review names its reviewer');
update public.ticket_redemptions
set reviewed_at = now(), reviewed_by = '00000000-0000-0000-0000-0000000022e5', review_note = 'Checked'
where id = '00000000-0000-0000-0000-00000022e001';
select is((select review_note from public.ticket_redemptions where id = '00000000-0000-0000-0000-00000022e001'), 'Checked',
  'the review fields can be filled in');
select throws_ok(
  $$update public.ticket_redemptions set review_note = 'Changed my mind' where id = '00000000-0000-0000-0000-00000022e001'$$,
  'P0001', 'This redemption has already been reviewed.', 'a review is recorded once');
select throws_ok(
  $$delete from public.booking_activities where id = '00000000-0000-0000-0000-00000022ba01'$$,
  'P0001', 'Lunch has already been redeemed on this booking, so that line cannot be removed.',
  'a redeemed entitlement cannot be deleted, and says why');

-- Devices
update public.staff_devices set last_seen_at = now() where id = '00000000-0000-0000-0000-00000022de01';
select is((select count(*)::int from public.audit_logs where table_name = 'staff_devices'
           and record_id = '00000000-0000-0000-0000-00000022de01' and action = 'UPDATE'), 0,
  'a device checking in is not audited (it would drown the log)');

-- As activity staff: locations only
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000022d4","role":"authenticated"}', true);
select ok((select count(*) from public.locations) >= 3, 'activity staff read locations');
select is((select count(*)::int from public.ticket_redemptions), 0, 'activity staff read no redemptions');
select is((select count(*)::int from public.message_log), 0, 'activity staff read no message log');
select is((select count(*)::int from public.staff_devices), 0, 'activity staff read no devices');

-- As a supervisor: no more reading than activity staff
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000022e5","role":"authenticated"}', true);
select is((select count(*)::int from public.ticket_redemptions), 0, 'a supervisor reads no redemptions directly');
select is((select count(*)::int from public.bookings), 0, 'a supervisor reads no bookings');

-- As a receptionist
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000022b2","role":"authenticated"}', true);
select ok((select count(*) from public.ticket_redemptions where booking_id = '00000000-0000-0000-0000-00000022b001') = 2,
  'reception reads redemptions');
select throws_ok(
  $$insert into public.ticket_redemptions (booking_id, booking_activity_id, activity_id, quantity_redeemed, client_uuid)
    values ('00000000-0000-0000-0000-00000022b001', '00000000-0000-0000-0000-00000022ba01', '00000000-0000-0000-0000-00000022ac01', 1, gen_random_uuid())$$,
  '42501', null, 'reception cannot write a redemption directly');

-- As an admin: never the device secret
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000022a1","role":"authenticated"}', true);
select throws_ok($$select device_secret_hash from public.staff_devices$$, '42501', null,
  'not even an admin reads a device''s secret hash');

select * from finish();
rollback;
