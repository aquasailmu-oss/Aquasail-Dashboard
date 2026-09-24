-- WP-06/WP-14: next_booking_reference() and create_booking(), which prices
-- every booking itself through build_quote().
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@test.local', '{"role":"admin","full_name":"Ada"}'),
  ('00000000-0000-0000-0000-0000000000b2', 'rec@test.local', '{"role":"receptionist","full_name":"Rita"}'),
  ('00000000-0000-0000-0000-0000000000c3', 'acc@test.local', '{"role":"accountant","full_name":"Carl"}');
-- The fleet rule keys on the CATAMARAN code, which seed data may already hold.
insert into public.activities (code, name) values ('CATAMARAN', 'Catamaran Cruise') on conflict (code) do nothing;
insert into public.activities (id, code, name) values ('00000000-0000-0000-0000-00000000ac02', 'T_LUNCH', 'Beach BBQ Lunch');
insert into public.packages (id, code, name, pricing_mode) values
  ('00000000-0000-0000-0000-00000000fa01', 'T_ISLAND', 'Island Explorer', 'bundle'),
  ('00000000-0000-0000-0000-00000000fa02', 'T_EMPTY', 'Misconfigured', 'bundle'),
  ('00000000-0000-0000-0000-00000000fa03', 'T_LUNCHONLY', 'Lunch deal', 'bundle');
insert into public.package_activities (package_id, activity_id) values
  ('00000000-0000-0000-0000-00000000fa01', (select id from public.activities where code = 'CATAMARAN')),
  ('00000000-0000-0000-0000-00000000fa01', '00000000-0000-0000-0000-00000000ac02'),
  ('00000000-0000-0000-0000-00000000fa03', '00000000-0000-0000-0000-00000000ac02');
insert into public.price_rules (scope, package_id, audience, participant_type, retail_cents, effective_from) values
  ('package', '00000000-0000-0000-0000-00000000fa01', 'walk_in', 'adult', 250000, '2026-01-01'),
  ('package', '00000000-0000-0000-0000-00000000fa02', 'walk_in', 'adult', 100000, '2026-01-01'),
  ('package', '00000000-0000-0000-0000-00000000fa03', 'walk_in', 'adult', 85000, '2026-01-01');
insert into public.resources (id, code, name, resource_type, capacity) values
  ('00000000-0000-0000-0000-0000000000f1', 'T_CAT_A', 'Catamaran A (test)', 'Catamaran', 20);
insert into public.tour_operators (id, code, name, settlement_model, payer) values
  ('00000000-0000-0000-0000-00000000de01', 'T_BEACH', 'Beachcomber Hotel', 'net_rate', 'operator');

-- References
select is(public.next_booking_reference('2097-09-17'), 'WS-20970917-0001', 'first reference of the day');
select is(public.next_booking_reference('2097-09-17'), 'WS-20970917-0002', 'references count up');
select is(public.next_booking_reference('2097-09-18'), 'WS-20970918-0001', 'each service date has its own counter');
update public.booking_sequences set last_number = 9999 where service_date = '2097-09-18';
select is(public.next_booking_reference('2097-09-18'), 'WS-20970918-10000', 'the counter widens past 9999 instead of wrapping');

-- 4 adults, Island Explorer at Rs 2,500, Rs 500 off, cash, boat assigned.
-- Note the smuggled unit price: the engine must ignore it.
create temp table p (name text primary key, body jsonb);
grant select on p to authenticated;
insert into p values ('walk_in', jsonb_build_object(
  'idempotency_key', 'key-1',
  'client', jsonb_build_object('first_name', 'Priya', 'last_name', 'Ramgoolam', 'phone_e164', '+23059990042'),
  'service_date', '2098-06-01', 'departure_time', '09:00',
  'resource_id', '00000000-0000-0000-0000-0000000000f1',
  'lines', jsonb_build_array(jsonb_build_object('target_type', 'package', 'target_id', '00000000-0000-0000-0000-00000000fa01',
    'participant_type', 'adult', 'quantity', 4, 'unit_charged_cents', 1)),
  'discount', jsonb_build_object('type', 'amount', 'value', 50000, 'reason', 'Returning guest'),
  'participants', jsonb_build_array(jsonb_build_object('participant_type', 'adult', 'count', 4)),
  'payment', jsonb_build_object('amount_cents', 950000, 'method', 'cash'),
  'expected_total_cents', 950000));

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);

select is((select public.create_booking(body) ->> 'created' from p where name = 'walk_in'), 'true', 'reception creates a booking');
select results_eq(
  $$select reference ~ '^WS-20980601-0001$', retail_total_cents, discount_total_cents, charged_total_cents, created_by
    from public.bookings where idempotency_key = 'key-1'$$,
  $$values (true, 1000000::bigint, 50000::bigint, 950000::bigint, '00000000-0000-0000-0000-0000000000b2'::uuid)$$,
  'the header is priced by the engine (a smuggled unit price is ignored)');
select results_eq(
  $$select i.unit_charged_cents, i.discount_cents, i.discount_reason, i.price_rule_id is not null
    from public.booking_items i join public.bookings b on b.id = i.booking_id where b.idempotency_key = 'key-1'$$,
  $$values (250000::bigint, 50000::bigint, 'Returning guest'::text, true)$$,
  'the line stores the price snapshot, discount and the rule it came from');
select results_eq(
  $$select a.code, ba.quantity from public.booking_activities ba join public.activities a on a.id = ba.activity_id
    join public.bookings b on b.id = ba.booking_id where b.idempotency_key = 'key-1' order by a.code$$,
  $$values ('CATAMARAN'::text, 4), ('T_LUNCH'::text, 4)$$,
  'the package expands into one entitlement per activity, times the quantity');
select is((select count(*) from public.tickets t join public.bookings b on b.id = t.booking_id
  where b.idempotency_key = 'key-1')::int, 1, 'a ticket is issued');
select results_eq(
  $$select p.amount_cents, p.recorded_by from public.payments p join public.bookings b on b.id = p.booking_id
    where b.idempotency_key = 'key-1'$$,
  $$values (950000::bigint, '00000000-0000-0000-0000-0000000000b2'::uuid)$$,
  'the payment is recorded in the receptionist''s name');

select is((select public.create_booking(body) ->> 'created' from p where name = 'walk_in'), 'false',
  'the same idempotency key returns the existing booking');
select is((select count(*) from public.bookings where created_by = '00000000-0000-0000-0000-0000000000b2')::int, 1,
  'a repeated submit creates no second booking');

-- Validation, each on a fresh key
select throws_ok(
  $$select public.create_booking((body || '{"idempotency_key":"k2"}'::jsonb) - 'resource_id') from p where name = 'walk_in'$$,
  'P0001', 'Assign a boat: this booking includes the catamaran.', 'a catamaran booking needs a boat');
select throws_ok(
  $$select public.create_booking(body || '{"idempotency_key":"k3","expected_total_cents":900000}') from p where name = 'walk_in'$$,
  'P0001', 'Prices changed while you were booking. Please review the total and submit again.',
  'a total that differs from the engine''s is refused, never silently changed');
select throws_ok(
  $$select public.create_booking((body || '{"idempotency_key":"k4","operator_id":"00000000-0000-0000-0000-00000000de01"}'::jsonb) - 'discount') from p where name = 'walk_in'$$,
  'P0001', null, 'an operator booking is re-priced for that operator (the walk-in total no longer matches)');
select throws_ok(
  $$select public.create_booking((body || '{"idempotency_key":"k5","operator_id":"00000000-0000-0000-0000-00000000de01","expected_total_cents":1000000}'::jsonb) - 'discount') from p where name = 'walk_in'$$,
  'P0001', 'Do not collect payment: Beachcomber Hotel pays for this booking on account.',
  'no payment on an operator-account booking');
select throws_ok(
  $$select public.create_booking(body || '{"idempotency_key":"k6","payment":{"amount_cents":960000,"method":"cash"}}') from p where name = 'walk_in'$$,
  'P0001', null, 'a payment above the total is refused');
select throws_ok(
  $$select public.create_booking(body || '{"idempotency_key":"k7"}') from p where name = 'walk_in'$$,
  'P0001', 'A client with phone +23059990042 already exists. Use the existing client.', 'a duplicate phone is caught with a readable message');

-- Atomicity: this fails after the client, booking and first line are written.
select throws_ok(
  $$select public.create_booking(jsonb_build_object('idempotency_key', 'k8', 'client', jsonb_build_object('first_name', 'Orphan', 'last_name', 'Test'),
      'service_date', '2098-06-01', 'lines', jsonb_build_array(jsonb_build_object('target_type', 'package',
      'target_id', '00000000-0000-0000-0000-00000000fa02', 'participant_type', 'adult', 'quantity', 1)),
      'participants', '[{"participant_type":"adult","count":1}]'::jsonb, 'expected_total_cents', 100000))$$,
  'P0001', 'Misconfigured has no activities configured. Ask an admin to fix it.', 'a failure part-way raises');
select results_eq(
  $$select (select count(*) from public.bookings where created_by = '00000000-0000-0000-0000-0000000000b2')::int,
           (select count(*) from public.clients where created_by = '00000000-0000-0000-0000-0000000000b2')::int$$,
  $$values (1, 1)$$,
  'a failed booking leaves no orphan rows');

select is(
  (select public.create_booking(jsonb_build_object('idempotency_key', 'k9', 'client', jsonb_build_object('first_name', 'Paper', 'last_name', 'Guest'),
     'service_date', public.today_mauritius() - 1, 'lines', jsonb_build_array(jsonb_build_object('target_type', 'package',
     'target_id', '00000000-0000-0000-0000-00000000fa03', 'participant_type', 'adult', 'quantity', 1)),
     'participants', '[{"participant_type":"adult","count":1}]'::jsonb, 'expected_total_cents', 85000)) ->> 'created'),
  'true', 'a past service date can be entered after an outage');
select matches((select notes from public.bookings where idempotency_key = 'k9'), '^Backdated entry, created ',
  'and is marked as a backdated entry');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}', true);
select throws_ok(
  $$select public.create_booking(body || '{"idempotency_key":"k10"}') from p where name = 'walk_in'$$,
  'P0001', 'Only reception or an admin can create bookings.', 'an accountant cannot create bookings');

reset role;
select is((select last_number from public.booking_sequences where service_date = '2098-06-01'), 1,
  'failed bookings consume no reference number');

select * from finish();
rollback;
