-- WP-24 (V2): scan_ticket() verdicts, in the plan's order, and what the
-- payload carries. The leak test over the serialised payload is in
-- tests/rls/scan.test.ts, through the public API.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000024b2', 'rec@t24.local', '{"role":"receptionist","full_name":"Rita"}'),
  ('00000000-0000-0000-0000-0000000024c3', 'acc@t24.local', '{"role":"accountant","full_name":"Carl"}'),
  ('00000000-0000-0000-0000-0000000024d4', 'staff@t24.local', '{"role":"activity_staff","full_name":"Sam Island"}');
insert into public.activities (id, code, name, sort_order) values
  ('00000000-0000-0000-0000-00000024ac01', 'T24_LUNCH', 'Lunch (t24)', 1),
  ('00000000-0000-0000-0000-00000024ac02', 'T24_PARA', 'Parasailing (t24)', 2);
insert into public.activities (id, code, name, is_active) values
  ('00000000-0000-0000-0000-00000024ac03', 'T24_RETIRED', 'Retired (t24)', false);
insert into public.clients (id, first_name, last_name, phone_e164, email) values
  ('00000000-0000-0000-0000-00000024c001', 'Jo', 'Smith', '+23057002424', 'jo@example.com');
insert into public.staff_devices (id, label, device_secret_hash) values
  ('00000000-0000-0000-0000-00000024de01', 'T24 tablet', encode(extensions.digest('s1', 'sha256'), 'hex'));

-- Bookings inserted directly: the verdicts, not create_booking(), are under test.
insert into public.bookings (id, reference, client_id, source_type, service_date, departure_time, meeting_point, charged_total_cents, notes) values
  ('00000000-0000-0000-0000-00000024b001', 'WS-T24-VALID', '00000000-0000-0000-0000-00000024c001', 'walk_in', public.today_mauritius(), '08:30', 'Jetty 2', 999900, 'VIP, pays cash'),
  ('00000000-0000-0000-0000-00000024b002', 'WS-T24-PART', '00000000-0000-0000-0000-00000024c001', 'walk_in', public.today_mauritius(), null, null, 0, null),
  ('00000000-0000-0000-0000-00000024b003', 'WS-T24-USED', '00000000-0000-0000-0000-00000024c001', 'walk_in', public.today_mauritius(), null, null, 0, null),
  ('00000000-0000-0000-0000-00000024b004', 'WS-T24-TMRW', '00000000-0000-0000-0000-00000024c001', 'walk_in', public.today_mauritius() + 1, null, null, 0, null),
  ('00000000-0000-0000-0000-00000024b005', 'WS-T24-CANC', '00000000-0000-0000-0000-00000024c001', 'walk_in', public.today_mauritius(), null, null, 0, null),
  ('00000000-0000-0000-0000-00000024b006', 'WS-T24-REVK', '00000000-0000-0000-0000-00000024c001', 'walk_in', public.today_mauritius(), null, null, 0, null);
update public.bookings set status = 'cancelled', cancellation_reason = 'Unwell' where id = '00000000-0000-0000-0000-00000024b005';
insert into public.booking_participants (booking_id, participant_type, count)
select id, 'adult', 4 from public.bookings where reference like 'WS-T24-%';
insert into public.booking_participants (booking_id, participant_type, count) values ('00000000-0000-0000-0000-00000024b001', 'child', 1);
insert into public.booking_activities (id, booking_id, activity_id, quantity)
select ('00000000-0000-0000-0000-0000002' || lpad(n::text, 5, '0'))::uuid, b.id, '00000000-0000-0000-0000-00000024ac01', 4
from public.bookings b cross join lateral (select right(b.id::text, 1)::int as n) x
where b.reference like 'WS-T24-%';
insert into public.tickets (booking_id, token)
select id, 'tok-' || lower(split_part(reference, '-', 3)) from public.bookings where reference like 'WS-T24-%';
update public.tickets set revoked_at = now(), revoke_reason = 'Lost phone' where booking_id = '00000000-0000-0000-0000-00000024b006';
insert into public.ticket_redemptions (booking_id, booking_activity_id, activity_id, quantity_redeemed, client_uuid, redeemed_by, redeemed_at, location_id) values
  ('00000000-0000-0000-0000-00000024b002', '00000000-0000-0000-0000-000000200002', '00000000-0000-0000-0000-00000024ac01', 3, gen_random_uuid(),
   '00000000-0000-0000-0000-0000000024d4', now() - interval '1 hour', (select id from public.locations where code = 'ISLAND')),
  ('00000000-0000-0000-0000-00000024b003', '00000000-0000-0000-0000-000000200003', '00000000-0000-0000-0000-00000024ac01', 4, gen_random_uuid(),
   '00000000-0000-0000-0000-0000000024d4', now() - interval '2 hours', (select id from public.locations where code = 'ISLAND'));

create function pg_temp.scan(p_token text) returns jsonb language sql as $$
  select public.scan_ticket(p_token, '00000000-0000-0000-0000-00000024de01', 's1')
$$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000024d4","role":"authenticated"}', true);

select is(pg_temp.scan('no-such-token'), '{"verdict":"NOT_FOUND"}'::jsonb, 'an unknown token is NOT_FOUND, with nothing else');
select is(pg_temp.scan('tok-revk') ->> 'verdict', 'REVOKED', 'a revoked ticket is REVOKED');
select is(pg_temp.scan('tok-canc') ->> 'verdict', 'CANCELLED', 'a cancelled booking is CANCELLED');
select results_eq($$select r ->> 'verdict', r ->> 'service_date' from pg_temp.scan('tok-tmrw') r$$,
  $$values ('WRONG_DATE', (public.today_mauritius() + 1)::text)$$, 'a ticket for tomorrow is WRONG_DATE and names its date');
select is(pg_temp.scan('tok-used') ->> 'verdict', 'ALREADY_REDEEMED', 'every entitlement used is ALREADY_REDEEMED');
select results_eq(
  $$select e -> 'last_event' ->> 'by_name', e -> 'last_event' ->> 'location_name', (e -> 'last_event' ->> 'at')::timestamptz
    from pg_temp.scan('tok-used') r, jsonb_array_elements(r -> 'entitlements') e$$,
  $$values ('Sam Island', 'Ile aux Cerfs', now() - interval '2 hours')$$,
  'ALREADY_REDEEMED carries when, by whom and where');
select results_eq(
  $$select r ->> 'verdict', (e ->> 'redeemed')::int, (e ->> 'remaining')::int
    from pg_temp.scan('tok-part') r, jsonb_array_elements(r -> 'entitlements') e$$,
  $$values ('PARTLY_USED', 3, 1)$$, 'some used is PARTLY_USED, with what remains');
select is(pg_temp.scan('  tok-valid ') ->> 'verdict', 'VALID', 'an untouched ticket is VALID (surrounding spaces from a scanner are ignored)');
select results_eq(
  $$select r ->> 'reference', r ->> 'client_surname', r ->> 'client_first_initial', (r ->> 'adults')::int, (r ->> 'children')::int,
           (r ->> 'infants')::int, r ->> 'departure_time', r ->> 'meeting_point'
    from pg_temp.scan('tok-valid') r$$,
  $$values ('WS-T24-VALID', 'Smith', 'J', 4, 1, 0, '08:30:00', 'Jetty 2')$$,
  'the payload carries the reference, surname, initial, party and departure');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(pg_temp.scan('tok-valid')) k),
  array['adults', 'booking_id', 'checked_in_at', 'checked_in_by_name', 'children', 'client_first_initial', 'client_surname',
        'departure_time', 'entitlements', 'infants', 'meeting_point', 'not_included', 'reference', 'service_date', 'verdict'],
  'the payload has exactly these keys: nothing added without this test changing');
select ok(pg_temp.scan('tok-valid')::text !~* 'jo@example|57002424|9999|VIP|"Jo"', 'no email, phone, total, note or first name');
select ok(
  (select bool_or(n ->> 'activity_code' = 'T24_PARA') from jsonb_array_elements(pg_temp.scan('tok-valid') -> 'not_included') n),
  'an activity the booking does not include is listed as not included');
select ok(
  not (select coalesce(bool_or(n ->> 'activity_code' in ('T24_LUNCH', 'T24_RETIRED')), false)
       from jsonb_array_elements(pg_temp.scan('tok-valid') -> 'not_included') n),
  'not included lists neither what the booking has nor retired activities');
select throws_ok($$select public.scan_ticket('tok-valid')$$,
  'P0001', 'This device is not registered. Ask a supervisor to register it.', 'island staff scan from a registered device');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000024c3","role":"authenticated"}', true);
select throws_ok($$select public.scan_ticket('tok-valid')$$, 'P0001', 'Your role cannot scan tickets.', 'an accountant cannot scan');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000024b2","role":"authenticated"}', true);
select is(public.scan_ticket('tok-valid') ->> 'verdict', 'VALID', 'reception scans from the desk without a registered device');

select * from finish();
rollback;
