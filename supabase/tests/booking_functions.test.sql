-- WP-06: next_booking_reference() and create_booking().
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@test.local', '{"role":"admin","full_name":"Ada"}'),
  ('00000000-0000-0000-0000-0000000000b2', 'rec@test.local', '{"role":"receptionist","full_name":"Rita"}'),
  ('00000000-0000-0000-0000-0000000000c3', 'acc@test.local', '{"role":"accountant","full_name":"Carl"}');
insert into public.activities (id, code, name) values
  ('00000000-0000-0000-0000-00000000ac01', 'CATAMARAN', 'Catamaran Cruise'),
  ('00000000-0000-0000-0000-00000000ac02', 'LUNCH', 'Beach BBQ Lunch'),
  ('00000000-0000-0000-0000-00000000ac03', 'PARASAIL', 'Parasailing');
insert into public.packages (id, code, name, pricing_mode) values
  ('00000000-0000-0000-0000-00000000fa01', 'ISLANDEXP', 'Island Explorer', 'bundle'),
  ('00000000-0000-0000-0000-00000000fa02', 'EMPTY', 'Misconfigured', 'bundle');
insert into public.package_activities (package_id, activity_id, quantity_per_participant) values
  ('00000000-0000-0000-0000-00000000fa01', '00000000-0000-0000-0000-00000000ac01', 1),
  ('00000000-0000-0000-0000-00000000fa01', '00000000-0000-0000-0000-00000000ac02', 1);
insert into public.resources (id, code, name, resource_type, capacity) values
  ('00000000-0000-0000-0000-0000000000f1', 'CAT_A', 'Catamaran A', 'Catamaran', 20);
insert into public.tour_operators (id, code, name, settlement_model, payer) values
  ('00000000-0000-0000-0000-00000000de01', 'BEACHCOMB', 'Beachcomber Hotel', 'net_rate', 'operator');

-- References
select is(public.next_booking_reference('2026-09-17'), 'WS-20260917-0001', 'first reference of the day');
select is(public.next_booking_reference('2026-09-17'), 'WS-20260917-0002', 'references count up');
select is(public.next_booking_reference('2026-09-18'), 'WS-20260918-0001', 'each service date has its own counter');
update public.booking_sequences set last_number = 9999 where service_date = '2026-09-18';
select is(public.next_booking_reference('2026-09-18'), 'WS-20260918-10000', 'the counter widens past 9999 instead of wrapping');

-- A reusable payload: 4 adults, Island Explorer at Rs 2,500, cash, boat assigned.
create temp table p (name text primary key, body jsonb);
grant select on p to authenticated;
insert into p values ('walk_in', jsonb_build_object(
  'idempotency_key', 'key-1',
  'client', jsonb_build_object('first_name', 'Priya', 'last_name', 'Ramgoolam', 'phone_e164', '+23057001234'),
  'source_type', 'walk_in', 'payer', 'client',
  'service_date', '2098-06-01', 'departure_time', '09:00',
  'resource_id', '00000000-0000-0000-0000-0000000000f1',
  'totals', jsonb_build_object('retail_total_cents', 1000000, 'charged_total_cents', 950000,
    'discount_total_cents', 50000, 'operator_net_total_cents', 0, 'commission_total_cents', 0),
  'items', jsonb_build_array(jsonb_build_object('line_type', 'package', 'package_id', '00000000-0000-0000-0000-00000000fa01',
    'participant_type', 'adult', 'quantity', 4, 'unit_retail_cents', 250000, 'unit_charged_cents', 250000,
    'commission_cents', 0, 'discount_cents', 50000, 'discount_reason', 'Returning guest')),
  'participants', jsonb_build_array(jsonb_build_object('participant_type', 'adult', 'count', 4)),
  'payment', jsonb_build_object('amount_cents', 950000, 'method', 'cash')));

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);

select is(
  (select public.create_booking(body) ->> 'created' from p where name = 'walk_in'), 'true',
  'reception creates a booking');
select results_eq(
  $$select reference ~ '^WS-\d{8}-0001$', charged_total_cents, client_id is not null, created_by
    from public.bookings where idempotency_key = 'key-1'$$,
  $$values (true, 950000::bigint, true, '00000000-0000-0000-0000-0000000000b2'::uuid)$$,
  'the booking header carries the reference, totals, new client and creator');
select results_eq(
  $$select a.code, ba.quantity from public.booking_activities ba join public.activities a on a.id = ba.activity_id
    join public.bookings b on b.id = ba.booking_id where b.idempotency_key = 'key-1' order by a.code$$,
  $$values ('CATAMARAN'::text, 4), ('LUNCH'::text, 4)$$,
  'a package line expands into one entitlement per activity, times the quantity');
select is((select count(*) from public.tickets t join public.bookings b on b.id = t.booking_id
  where b.idempotency_key = 'key-1')::int, 1, 'a ticket is issued');
select results_eq(
  $$select p.amount_cents, p.recorded_by from public.payments p join public.bookings b on b.id = p.booking_id
    where b.idempotency_key = 'key-1'$$,
  $$values (950000::bigint, '00000000-0000-0000-0000-0000000000b2'::uuid)$$,
  'the payment is recorded in the receptionist''s name');

select is(
  (select public.create_booking(body) ->> 'created' from p where name = 'walk_in'), 'false',
  'the same idempotency key returns the existing booking');
select is((select count(*) from public.bookings where created_by = '00000000-0000-0000-0000-0000000000b2')::int, 1,
  'a repeated submit creates no second booking');

-- Validation, each on a fresh key
select throws_ok(
  $$select public.create_booking((body || '{"idempotency_key":"k2"}'::jsonb) - 'resource_id') from p where name = 'walk_in'$$,
  'P0001', 'Assign a boat: this booking includes the catamaran.', 'a catamaran booking needs a boat');
select throws_ok(
  $$select public.create_booking(jsonb_set(body || '{"idempotency_key":"k3"}', '{totals,charged_total_cents}', '1')) from p where name = 'walk_in'$$,
  'P0001', 'The booking totals do not add up. Please review the booking and try again.', 'totals must equal the line sums');
select throws_ok(
  $$select public.create_booking(body || '{"idempotency_key":"k4","source_type":"operator","payer":"operator","operator_id":"00000000-0000-0000-0000-00000000de01"}') from p where name = 'walk_in'$$,
  'P0001', 'Do not collect payment: Beachcomber Hotel pays for this booking on account.', 'no payment on an operator-account booking');
select throws_ok(
  $$select public.create_booking(body || '{"idempotency_key":"k5","source_type":"operator","payer":"client","operator_id":"00000000-0000-0000-0000-00000000de01"}') from p where name = 'walk_in'$$,
  'P0001', null, 'the payer must match the operator''s configuration');
select throws_ok(
  $$select public.create_booking(body || '{"idempotency_key":"k6"}') from p where name = 'walk_in'$$,
  'P0001', 'A client with phone +23057001234 already exists. Use the existing client.', 'a duplicate phone is caught with a readable message');

-- Atomicity: this fails after the client, booking and first line are written.
select throws_ok(
  $$select public.create_booking(jsonb_set(body || '{"idempotency_key":"k7","client":{"first_name":"Orphan","last_name":"Test"}}',
      '{items,0,package_id}', '"00000000-0000-0000-0000-00000000fa02"')) from p where name = 'walk_in'$$,
  'P0001', 'This package has no activities configured. Ask an admin to fix it.', 'a failure part-way raises');
select results_eq(
  $$select (select count(*) from public.bookings where created_by = '00000000-0000-0000-0000-0000000000b2')::int,
           (select count(*) from public.clients where first_name in ('Priya', 'Orphan'))::int,
           (select count(*) from public.booking_items i join public.bookings b on b.id = i.booking_id
             where b.created_by = '00000000-0000-0000-0000-0000000000b2')::int$$,
  $$values (1, 1, 1)$$,
  'a failed booking leaves no orphan rows');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}', true);
select throws_ok(
  $$select public.create_booking(body || '{"idempotency_key":"k8"}') from p where name = 'walk_in'$$,
  'P0001', 'Only reception or an admin can create bookings.', 'an accountant cannot create bookings');

select throws_ok($$select public.next_booking_reference(current_date)$$, '42501', null,
  'the reference counter cannot be called directly');

reset role;
select is((select last_number from public.booking_sequences where service_date = '2098-06-01'), 1,
  'failed bookings consume no reference number');

select * from finish();
rollback;
