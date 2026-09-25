-- WP-16: amend_booking(), payment correction limits, staff_names().
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@test.local', '{"role":"admin","full_name":"Ada"}'),
  ('00000000-0000-0000-0000-0000000000b2', 'rec@test.local', '{"role":"receptionist","full_name":"Rita Ramsamy"}'),
  ('00000000-0000-0000-0000-0000000000d4', 'staff@test.local', '{"role":"activity_staff","full_name":"Sam"}');
insert into public.activities (id, code, name) values
  ('00000000-0000-0000-0000-00000000ac01', 'T_PARA', 'Parasailing (t)'),
  ('00000000-0000-0000-0000-00000000ac02', 'T_TUBE', 'Tube (t)');
insert into public.price_rules (scope, activity_id, audience, participant_type, retail_cents, effective_from) values
  ('activity', '00000000-0000-0000-0000-00000000ac01', 'walk_in', 'adult', 220000, '2026-01-01'),
  ('activity', '00000000-0000-0000-0000-00000000ac01', 'walk_in', 'child', 160000, '2026-01-01'),
  ('activity', '00000000-0000-0000-0000-00000000ac02', 'walk_in', 'adult', 120000, '2026-01-01');
insert into public.clients (id, first_name, last_name) values ('00000000-0000-0000-0000-00000000c001', 'Amend', 'Test');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
create temp table ids (name text primary key, id uuid);
grant all on ids to authenticated;
insert into ids select 'today', (public.create_booking(jsonb_build_object('idempotency_key', 'am-1', 'client_id', '00000000-0000-0000-0000-00000000c001',
  'service_date', public.today_mauritius(), 'lines', '[{"target_type":"activity","target_id":"00000000-0000-0000-0000-00000000ac01","participant_type":"adult","quantity":2}]'::jsonb,
  'participants', '[{"participant_type":"adult","count":2}]'::jsonb, 'payment', '{"amount_cents":440000,"method":"cash"}'::jsonb,
  'expected_total_cents', 440000)) ->> 'booking_id')::uuid;
insert into ids select 'past', (public.create_booking(jsonb_build_object('idempotency_key', 'am-2', 'client_id', '00000000-0000-0000-0000-00000000c001',
  'service_date', public.today_mauritius() - 1, 'lines', '[{"target_type":"activity","target_id":"00000000-0000-0000-0000-00000000ac02","participant_type":"adult","quantity":1}]'::jsonb,
  'participants', '[{"participant_type":"adult","count":1}]'::jsonb, 'expected_total_cents', 120000)) ->> 'booking_id')::uuid;

create function pg_temp.amend(p_name text, p_lines jsonb, p_participants jsonb, p_expected bigint) returns jsonb language sql as $$
  select public.amend_booking((select id from ids where name = p_name),
    jsonb_build_object('lines', p_lines, 'participants', p_participants, 'expected_total_cents', p_expected, 'notes', 'amended'))
$$;

-- Add a child and a tube ride: 2×2,200 + 1×1,600 + 2×1,200 = 8,400
select results_eq(
  $$select (r ->> 'previous_total_cents')::bigint, (r ->> 'charged_total_cents')::bigint, (r ->> 'paid_cents')::bigint
    from pg_temp.amend('today',
      '[{"target_type":"activity","target_id":"00000000-0000-0000-0000-00000000ac01","participant_type":"adult","quantity":2},
        {"target_type":"activity","target_id":"00000000-0000-0000-0000-00000000ac01","participant_type":"child","quantity":1},
        {"target_type":"activity","target_id":"00000000-0000-0000-0000-00000000ac02","participant_type":"adult","quantity":2}]',
      '[{"participant_type":"adult","count":2},{"participant_type":"child","count":1}]', 840000) r$$,
  $$values (440000::bigint, 840000::bigint, 440000::bigint)$$,
  'an amendment re-prices: was Rs 4,400, now Rs 8,400, Rs 4,400 already paid');
select is((select charged_total_cents from public.bookings where id = (select id from ids where name = 'today')), 840000::bigint,
  'the booking header carries the new total');
select is((select count(*)::int from public.booking_items where booking_id = (select id from ids where name = 'today')), 3,
  'lines were added');

reset role;
select is((select count(*)::int from public.audit_logs where table_name = 'booking_items' and action = 'UPDATE'
  and new_data ->> 'booking_id' = (select id::text from ids where name = 'today')), 0,
  'the unchanged adult parasailing line was not rewritten');
select is((select count(*)::int from public.audit_logs where table_name = 'booking_items' and action = 'INSERT'
  and new_data ->> 'booking_id' = (select id::text from ids where name = 'today')), 3,
  'the audit log shows the original line and the two added ones');
set local role authenticated;

-- Remove the tube: its line and entitlement go, audited.
select pg_temp.amend('today',
  '[{"target_type":"activity","target_id":"00000000-0000-0000-0000-00000000ac01","participant_type":"adult","quantity":2},
    {"target_type":"activity","target_id":"00000000-0000-0000-0000-00000000ac01","participant_type":"child","quantity":1}]',
  '[{"participant_type":"adult","count":2},{"participant_type":"child","count":1}]', 600000);
select results_eq(
  $$select a.code, sum(ba.quantity)::int from public.booking_activities ba join public.activities a on a.id = ba.activity_id
    where ba.booking_id = (select id from ids where name = 'today') group by a.code$$,
  $$values ('T_PARA'::text, 3)$$,
  'removing a line removes its entitlement');

select throws_ok(
  $$select pg_temp.amend('today', '[{"target_type":"activity","target_id":"00000000-0000-0000-0000-00000000ac02","participant_type":"adult","quantity":1}]',
    '[{"participant_type":"adult","count":1}]', 120000)$$,
  'P0001', null, 'a new total below what was paid needs a refund first');
select throws_ok(
  $$select pg_temp.amend('today', '[{"target_type":"activity","target_id":"00000000-0000-0000-0000-00000000ac01","participant_type":"adult","quantity":3}]',
    '[{"participant_type":"adult","count":3}]', 1)$$,
  'P0001', 'Prices changed while you were editing. Please review the total and save again.', 'the displayed total must match');
select throws_ok(
  $$select pg_temp.amend('past', '[{"target_type":"activity","target_id":"00000000-0000-0000-0000-00000000ac02","participant_type":"adult","quantity":2}]',
    '[{"participant_type":"adult","count":2}]', 240000)$$,
  'P0001', null, 'reception cannot amend a past booking');

-- Payment corrections
select throws_ok(
  $$insert into public.payments (booking_id, amount_cents, method, received_from, is_correction, corrects_payment_id, note)
    select booking_id, -500000, method, 'client', true, id, 'too much' from public.payments where booking_id = (select id from ids where name = 'today')$$,
  'P0001', null, 'a correction cannot reverse more than the original payment');
select lives_ok(
  $$insert into public.payments (booking_id, amount_cents, method, received_from, is_correction, corrects_payment_id, note)
    select booking_id, -40000, method, 'client', true, id, 'Overcharged' from public.payments where booking_id = (select id from ids where name = 'today') and not is_correction$$,
  'a partial correction is accepted');
select throws_ok(
  $$insert into public.payments (booking_id, amount_cents, method, received_from, is_correction, corrects_payment_id, note)
    select booking_id, -400001, method, 'client', true, id, 'again' from public.payments where booking_id = (select id from ids where name = 'today') and not is_correction$$,
  'P0001', null, 'later corrections count what was already corrected');

select is((select full_name from public.staff_names(array['00000000-0000-0000-0000-0000000000b2'::uuid])), 'Rita Ramsamy',
  'reception can see staff names');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d4","role":"authenticated"}', true);
select is_empty($$select * from public.staff_names(array['00000000-0000-0000-0000-0000000000b2'::uuid])$$, 'activity staff cannot');

select * from finish();
rollback;
