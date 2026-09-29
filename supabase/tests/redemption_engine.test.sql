-- WP-23 (V2): the redemption engine. redeem_activity(), check_in_booking(),
-- reverse_redemption(), resolve_over_redemption(), and entitlements that
-- carry redemptions. Concurrency (two scans of the last lunch at once) needs
-- real parallel connections: tests/rls/redemption.test.ts proves it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(39);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000023a1', 'admin@t23.local', '{"role":"admin","full_name":"Ada Admin"}'),
  ('00000000-0000-0000-0000-0000000023b2', 'rec@t23.local', '{"role":"receptionist","full_name":"Rita Ramsamy"}'),
  ('00000000-0000-0000-0000-0000000023c3', 'acc@t23.local', '{"role":"accountant","full_name":"Carl"}'),
  ('00000000-0000-0000-0000-0000000023d4', 'staff@t23.local', '{"role":"activity_staff","full_name":"Sam Island"}'),
  ('00000000-0000-0000-0000-0000000023e5', 'sup@t23.local', '{"role":"activity_supervisor","full_name":"Sue Supervisor"}');
insert into public.activities (id, code, name, is_redeemable) values
  ('00000000-0000-0000-0000-00000023ac01', 'T23_LUNCH', 'Beach Lunch (t)', true),
  ('00000000-0000-0000-0000-00000023ac02', 'T23_TRANSFER', 'Transfer (t)', false);
insert into public.price_rules (scope, activity_id, audience, participant_type, retail_cents, effective_from) values
  ('activity', '00000000-0000-0000-0000-00000023ac01', 'walk_in', 'adult', 50000, '2026-01-01'),
  ('activity', '00000000-0000-0000-0000-00000023ac01', 'walk_in', 'child', 30000, '2026-01-01'),
  ('activity', '00000000-0000-0000-0000-00000023ac02', 'walk_in', 'adult', 10000, '2026-01-01');
insert into public.clients (id, first_name, last_name) values ('00000000-0000-0000-0000-00000023c001', 'Jo', 'Smith');
insert into public.staff_devices (id, label, location_id, device_secret_hash, is_active)
select v.id, v.label, (select id from public.locations where code = 'ISLAND'), encode(extensions.digest(v.secret, 'sha256'), 'hex'), v.active
from (values
  ('00000000-0000-0000-0000-00000023de01'::uuid, 'T23 tablet', 's1', true),
  ('00000000-0000-0000-0000-00000023de02'::uuid, 'T23 lost tablet', 's2', false)
) v (id, label, secret, active);

create temp table ids (name text primary key, id uuid);
grant all on ids to authenticated;
create function pg_temp.act(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.id(p_name text) returns uuid language sql as $$ select id from ids where name = p_name $$;
-- The test's own lookups, past RLS: the calls under test still run as the real role.
create function pg_temp.redemption(p_client_uuid uuid) returns public.ticket_redemptions language sql security definer as $$
  select * from public.ticket_redemptions where client_uuid = p_client_uuid
$$;
create function pg_temp.reversal_of(p_id uuid) returns uuid language sql security definer as $$
  select id from public.ticket_redemptions where reverses_redemption_id = p_id
$$;
create function pg_temp.book(p_key text, p_date date, p_lines jsonb, p_participants jsonb, p_total bigint) returns uuid language sql as $$
  select (public.create_booking(jsonb_build_object('idempotency_key', p_key, 'client_id', '00000000-0000-0000-0000-00000023c001',
    'service_date', p_date, 'lines', p_lines, 'participants', p_participants, 'expected_total_cents', p_total)) ->> 'booking_id')::uuid
$$;
-- Staff on the registered tablet.
create function pg_temp.redeem(p_entitlement text, p_quantity int, p_uuid uuid, p_from_queue boolean default false,
                               p_at timestamptz default null) returns jsonb language sql as $$
  select public.redeem_activity(p_booking_activity_id => pg_temp.id(p_entitlement), p_quantity => p_quantity, p_client_uuid => p_uuid,
    p_device_id => '00000000-0000-0000-0000-00000023de01', p_device_secret => 's1', p_occurred_at_device => p_at, p_from_queue => p_from_queue)
$$;

-- Bookings, created by reception as in real use.
set local role authenticated;
select pg_temp.act('00000000-0000-0000-0000-0000000023b2');
insert into ids select 'today', pg_temp.book('t23-1', public.today_mauritius(),
  '[{"target_type":"activity","target_id":"00000000-0000-0000-0000-00000023ac01","participant_type":"adult","quantity":4},
    {"target_type":"activity","target_id":"00000000-0000-0000-0000-00000023ac01","participant_type":"child","quantity":1},
    {"target_type":"activity","target_id":"00000000-0000-0000-0000-00000023ac02","participant_type":"adult","quantity":4}]',
  '[{"participant_type":"adult","count":4},{"participant_type":"child","count":1}]', 270000);
insert into ids select 'tomorrow', pg_temp.book('t23-2', public.today_mauritius() + 1,
  '[{"target_type":"activity","target_id":"00000000-0000-0000-0000-00000023ac01","participant_type":"adult","quantity":1}]',
  '[{"participant_type":"adult","count":1}]', 50000);
insert into ids select 'cancelled', pg_temp.book('t23-3', public.today_mauritius(),
  '[{"target_type":"activity","target_id":"00000000-0000-0000-0000-00000023ac01","participant_type":"adult","quantity":1}]',
  '[{"participant_type":"adult","count":1}]', 50000);
insert into ids select 'revoked', pg_temp.book('t23-4', public.today_mauritius(),
  '[{"target_type":"activity","target_id":"00000000-0000-0000-0000-00000023ac01","participant_type":"adult","quantity":1}]',
  '[{"participant_type":"adult","count":1}]', 50000);
update public.bookings set status = 'cancelled', cancellation_reason = 'Guest unwell' where id = pg_temp.id('cancelled');

reset role;
update public.tickets set revoked_at = now(), revoke_reason = 'Lost phone' where booking_id = pg_temp.id('revoked');
insert into ids
select b.name || '_' || lower(replace(a.code, 'T23_', '')) || coalesce('_' || bi.participant_type::text, ''), ba.id
from ids b
join public.booking_activities ba on ba.booking_id = b.id
join public.activities a on a.id = ba.activity_id
left join public.booking_items bi on bi.id = ba.source_item_id;
set local role authenticated;

-- ---------------------------------------------------------------------------
-- Redeeming, as island staff on a registered device
-- ---------------------------------------------------------------------------
select pg_temp.act('00000000-0000-0000-0000-0000000023d4');

select results_eq(
  $$select (r ->> 'remaining')::int, (r ->> 'redeemed_total')::int, (r ->> 'already_applied')::boolean, (r ->> 'is_over_redemption')::boolean
    from pg_temp.redeem('today_lunch_adult', 3, '00000000-0000-0000-0000-000000230001') r$$,
  $$values (1, 3, false, false)$$,
  'three of four lunches redeemed: one remains');
select results_eq(
  $$select (r ->> 'redemption_id')::uuid, (r ->> 'already_applied')::boolean, (r ->> 'remaining')::int
    from pg_temp.redeem('today_lunch_adult', 3, '00000000-0000-0000-0000-000000230001') r$$,
  $$select (pg_temp.redemption('00000000-0000-0000-0000-000000230001')).id, true, 1$$,
  'the same client_uuid again returns the same row, marked already applied, and counts nothing twice');
select throws_ok(
  $$select pg_temp.redeem('today_lunch_child', 1, '00000000-0000-0000-0000-000000230001')$$,
  'P0001', 'This request id was already used for a different redemption.', 'a request id cannot be reused for another entitlement');
select throws_like(
  $$select pg_temp.redeem('today_lunch_adult', 2, gen_random_uuid())$$,
  'Only 1 Beach Lunch (t) remaining on WS-%. You asked for 2.', 'an online over-redemption is refused, naming what remains');
select results_eq(
  $$select (r ->> 'is_over_redemption')::boolean, (r ->> 'redeemed_total')::int, (r ->> 'remaining')::int
    from pg_temp.redeem('today_lunch_adult', 2, '00000000-0000-0000-0000-000000230002', true, now() - interval '1 hour') r$$,
  $$values (true, 5, 0)$$,
  'a queued (offline) over-redemption is recorded and flagged, not rejected');
select is((pg_temp.redemption('00000000-0000-0000-0000-000000230002')).occurred_at_device,
  now() - interval '1 hour', 'the device''s own time is kept beside the sync time');
select throws_like(
  $$select pg_temp.redeem('today_lunch_adult', 1, gen_random_uuid())$$,
  'No Beach Lunch (t) remaining on WS-%: all 4 have been redeemed.', 'an exhausted entitlement says so');
select throws_ok(
  $$select pg_temp.redeem('today_transfer_adult', 1, gen_random_uuid())$$,
  'P0001', 'Transfer (t) is not redeemed on the ticket.', 'an activity that is not redeemable cannot be redeemed');
select throws_ok(
  $$select pg_temp.redeem('today_lunch_child', 0, gen_random_uuid())$$,
  'P0001', 'Redeem at least one.', 'a quantity below one is refused');

-- The booking, its date and its ticket
select throws_like($$select pg_temp.redeem('tomorrow_lunch_adult', 1, gen_random_uuid())$$,
  'Booking WS-% is for %, not today. Send the customer to reception.', 'a ticket for another day is refused, naming its date');
select throws_like($$select pg_temp.redeem('cancelled_lunch_adult', 1, gen_random_uuid())$$,
  'Booking WS-% was cancelled. Send the customer to reception.', 'a cancelled booking cannot be redeemed');
select throws_like($$select pg_temp.redeem('revoked_lunch_adult', 1, gen_random_uuid())$$,
  'This ticket for WS-% was replaced by a newer one.%', 'a revoked ticket cannot be redeemed');

-- The device
select throws_ok(
  $$select public.redeem_activity(p_booking_activity_id => pg_temp.id('today_lunch_child'), p_quantity => 1, p_client_uuid => gen_random_uuid())$$,
  'P0001', 'This device is not registered. Ask a supervisor to register it.', 'island staff cannot redeem without a registered device');
select throws_ok(
  $$select public.redeem_activity(p_booking_activity_id => pg_temp.id('today_lunch_child'), p_quantity => 1, p_client_uuid => gen_random_uuid(),
      p_device_id => '00000000-0000-0000-0000-00000023de01', p_device_secret => 'guess')$$,
  'P0001', 'This device is not recognised. Ask a supervisor to register it again.', 'a wrong device secret is refused');
select throws_ok(
  $$select public.redeem_activity(p_booking_activity_id => pg_temp.id('today_lunch_child'), p_quantity => 1, p_client_uuid => gen_random_uuid(),
      p_device_id => '00000000-0000-0000-0000-00000023de02', p_device_secret => 's2')$$,
  'P0001', 'This device has been deactivated. Ask a supervisor.', 'a deactivated device stops at once');

-- Undo within the minute, by the person who redeemed
select results_eq(
  $$select (r ->> 'remaining')::int from pg_temp.redeem('today_lunch_child', 1, '00000000-0000-0000-0000-000000230003') r$$,
  $$values (0)$$, 'the child''s lunch is redeemed');
select results_eq(
  $$select (r ->> 'remaining')::int from public.reverse_redemption(
      (pg_temp.redemption('00000000-0000-0000-0000-000000230003')).id, 'Undo within 30 s',
      p_device_id => '00000000-0000-0000-0000-00000023de01', p_device_secret => 's1') r$$,
  $$values (1)$$, 'staff can undo their own redemption straight away, restoring the remaining count');

reset role;
insert into public.ticket_redemptions (id, booking_id, booking_activity_id, activity_id, quantity_redeemed, client_uuid, redeemed_by, redeemed_at) values
  ('00000000-0000-0000-0000-00000023f001', pg_temp.id('today'), pg_temp.id('today_lunch_child'), '00000000-0000-0000-0000-00000023ac01', 1,
   gen_random_uuid(), '00000000-0000-0000-0000-0000000023d4', now() - interval '2 minutes'),
  ('00000000-0000-0000-0000-00000023f002', pg_temp.id('today'), pg_temp.id('today_lunch_child'), '00000000-0000-0000-0000-00000023ac01', 1,
   gen_random_uuid(), '00000000-0000-0000-0000-0000000023d4', now() - interval '25 hours');
set local role authenticated;

select throws_ok(
  $$select public.reverse_redemption('00000000-0000-0000-0000-00000023f001', 'Oops',
      p_device_id => '00000000-0000-0000-0000-00000023de01', p_device_secret => 's1')$$,
  'P0001', 'Only a supervisor can reverse this redemption now. Ask them.', 'after the minute, staff cannot reverse');
select pg_temp.act('00000000-0000-0000-0000-0000000023b2');
select throws_ok($$select public.reverse_redemption('00000000-0000-0000-0000-00000023f001', 'Oops')$$,
  'P0001', 'Only a supervisor can reverse this redemption now. Ask them.', 'reception cannot reverse someone else''s redemption');
select pg_temp.act('00000000-0000-0000-0000-0000000023c3');
select throws_ok($$select pg_temp.redeem('today_lunch_child', 1, gen_random_uuid())$$,
  'P0001', 'Your role cannot redeem activities.', 'an accountant cannot redeem');

-- ---------------------------------------------------------------------------
-- The supervisor
-- ---------------------------------------------------------------------------
select pg_temp.act('00000000-0000-0000-0000-0000000023e5');
create function pg_temp.sup_reverse(p_id uuid, p_reason text) returns jsonb language sql as $$
  select public.reverse_redemption(p_id, p_reason, p_device_id => '00000000-0000-0000-0000-00000023de01', p_device_secret => 's1')
$$;
select results_eq(
  $$select (r ->> 'remaining')::int, (r ->> 'redeemed_total')::int
    from pg_temp.sup_reverse('00000000-0000-0000-0000-00000023f001', 'Mis-scan') r$$,
  $$values (0, 1)$$, 'a supervisor reverses a recent redemption');
select throws_ok($$select pg_temp.sup_reverse('00000000-0000-0000-0000-00000023f001', 'Again')$$,
  'P0001', 'This redemption has already been reversed.', 'a redemption is reversed at most once');
select throws_ok(
  $$select pg_temp.sup_reverse(pg_temp.reversal_of('00000000-0000-0000-0000-00000023f001'), 'x')$$,
  'P0001', 'This is already a reversal. Reverse the original redemption instead.', 'a reversal cannot be reversed');
select throws_ok($$select pg_temp.sup_reverse('00000000-0000-0000-0000-00000023f002', 'Old')$$,
  'P0001', 'This redemption is more than 24 hours old. Only an admin can reverse it now.', 'a supervisor''s reach is 24 hours');
select pg_temp.act('00000000-0000-0000-0000-0000000023a1');
select throws_ok($$select public.reverse_redemption('00000000-0000-0000-0000-00000023f002', '  ')$$,
  'P0001', 'Give a reason for reversing this redemption.', 'a reversal needs a reason');
select lives_ok($$select public.reverse_redemption('00000000-0000-0000-0000-00000023f002', 'Found in the kitchen log')$$,
  'an admin reverses at any age');

-- Resolving a flagged over-redemption
select pg_temp.act('00000000-0000-0000-0000-0000000023d4');
select throws_ok(
  $$select public.resolve_over_redemption((pg_temp.redemption('00000000-0000-0000-0000-000000230002')).id, 'accept', 'x')$$,
  'P0001', 'Only a supervisor or an admin can resolve a flagged redemption.', 'staff cannot resolve a flag');
select pg_temp.act('00000000-0000-0000-0000-0000000023e5');
select results_eq(
  $$select r ->> 'action', r -> 'reversal' = 'null'::jsonb
    from public.resolve_over_redemption((pg_temp.redemption('00000000-0000-0000-0000-000000230002')).id,
      'accept', 'Two tablets served the same party offline; party had 5 lunches',
      p_device_id => '00000000-0000-0000-0000-00000023de01', p_device_secret => 's1') r$$,
  $$values ('accept', true)$$, 'a supervisor accepts a flagged row with a note');
select results_eq(
  $$select r.reviewed_by, r.review_note from pg_temp.redemption('00000000-0000-0000-0000-000000230002') r$$,
  $$values ('00000000-0000-0000-0000-0000000023e5'::uuid, 'Two tablets served the same party offline; party had 5 lunches')$$,
  'the resolution is recorded on the row, with who and why');
select throws_ok(
  $$select public.resolve_over_redemption('00000000-0000-0000-0000-00000023f001', 'accept', 'x',
      p_device_id => '00000000-0000-0000-0000-00000023de01', p_device_secret => 's1')$$,
  'P0001', 'This redemption is not flagged for review.', 'only flagged rows are resolved');

-- ---------------------------------------------------------------------------
-- Check-in
-- ---------------------------------------------------------------------------
select pg_temp.act('00000000-0000-0000-0000-0000000023d4');
select results_eq(
  $$select (r ->> 'already_checked_in')::boolean, (r ->> 'checked_in_at')::timestamptz, r ->> 'checked_in_by_name',
           jsonb_array_length(r -> 'entitlements')
    from public.check_in_booking(pg_temp.id('today'), '00000000-0000-0000-0000-000000230010',
      p_device_id => '00000000-0000-0000-0000-00000023de01', p_device_secret => 's1',
      p_occurred_at_device => now() - interval '10 minutes', p_from_queue => true) r$$,
  $$values (false, now() - interval '10 minutes', 'Sam Island', 2)$$,
  'check-in records the arrival (the device''s time, from the queue) and returns the redeemable entitlements');
select results_eq(
  $$select (r ->> 'already_checked_in')::boolean, (r ->> 'already_applied')::boolean, (r ->> 'checked_in_at')::timestamptz
    from public.check_in_booking(pg_temp.id('today'), gen_random_uuid(),
      p_device_id => '00000000-0000-0000-0000-00000023de01', p_device_secret => 's1') r$$,
  $$values (true, false, now() - interval '10 minutes')$$,
  'a second check-in keeps the original arrival time');
select results_eq(
  $$select (r ->> 'already_applied')::boolean
    from public.check_in_booking(pg_temp.id('today'), '00000000-0000-0000-0000-000000230010',
      p_device_id => '00000000-0000-0000-0000-00000023de01', p_device_secret => 's1') r$$,
  $$values (true)$$, 'a retried check-in is recognised as the same request');
select throws_like(
  $$select public.check_in_booking(pg_temp.id('cancelled'), gen_random_uuid(),
      p_device_id => '00000000-0000-0000-0000-00000023de01', p_device_secret => 's1')$$,
  'Booking WS-% was cancelled.%', 'a cancelled booking cannot be checked in');
select ok(
  (select public.check_in_booking(pg_temp.id('today'), gen_random_uuid(),
     p_device_id => '00000000-0000-0000-0000-00000023de01', p_device_secret => 's1')::text !~* 'cents|price|total|phone|email|note'),
  'the check-in payload carries no money, contact details or notes');

-- ---------------------------------------------------------------------------
-- Amending a booking that has redemptions
-- ---------------------------------------------------------------------------
select pg_temp.act('00000000-0000-0000-0000-0000000023b2');
create function pg_temp.amend(p_adult_lunch int, p_child_lunch boolean, p_total bigint) returns jsonb language sql as $$
  select public.amend_booking(pg_temp.id('today'), jsonb_build_object(
    'lines', jsonb_build_array(
      jsonb_build_object('target_type', 'activity', 'target_id', '00000000-0000-0000-0000-00000023ac01', 'participant_type', 'adult', 'quantity', p_adult_lunch),
      jsonb_build_object('target_type', 'activity', 'target_id', '00000000-0000-0000-0000-00000023ac02', 'participant_type', 'adult', 'quantity', 4))
      || case when p_child_lunch then jsonb_build_array(jsonb_build_object('target_type', 'activity',
           'target_id', '00000000-0000-0000-0000-00000023ac01', 'participant_type', 'child', 'quantity', 1)) else '[]'::jsonb end,
    'participants', '[{"participant_type":"adult","count":6},{"participant_type":"child","count":1}]'::jsonb,
    'expected_total_cents', p_total))
$$;
select throws_ok($$select pg_temp.amend(1, true, 120000)$$,
  'P0001', '5 x Beach Lunch (t) already redeemed on this booking, so it cannot go below 5.',
  'an amendment cannot take an entitlement below what was redeemed');
select lives_ok($$select pg_temp.amend(6, true, 370000)$$, 'adding two more lunches after some were redeemed is allowed');
select results_eq(
  $$select id, quantity from public.booking_activities where booking_id = pg_temp.id('today') and activity_id = '00000000-0000-0000-0000-00000023ac01'
    and source_item_id in (select id from public.booking_items where participant_type = 'adult')$$,
  $$select pg_temp.id('today_lunch_adult'), 6$$,
  'the entitlement is scaled in place: same row, so its redemptions stay attached');
select throws_ok($$select pg_temp.amend(6, false, 340000)$$,
  'P0001', 'Beach Lunch (t) has already been redeemed on this booking, so that line cannot be removed.',
  'a line whose entitlement has redemptions cannot be removed');

select * from finish();
rollback;
