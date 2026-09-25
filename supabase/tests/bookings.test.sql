-- WP-05: clients, bookings, payments and tickets: constraints and RLS.
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

-- Fixtures, created as the migration owner.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@test.local', '{"role":"admin","full_name":"Ada"}'),
  ('00000000-0000-0000-0000-0000000000b2', 'rec@test.local', '{"role":"receptionist","full_name":"Rita"}'),
  ('00000000-0000-0000-0000-0000000000c3', 'acc@test.local', '{"role":"accountant","full_name":"Carl"}'),
  ('00000000-0000-0000-0000-0000000000d4', 'staff@test.local', '{"role":"activity_staff","full_name":"Sam"}');
insert into public.clients (id, first_name, last_name, phone_e164, email) values
  ('00000000-0000-0000-0000-00000000c001', 'Priya', 'Ramgoolam', '+23057001234', 'Priya@Example.com');
insert into public.bookings (id, reference, client_id, source_type, service_date, charged_total_cents) values
  ('00000000-0000-0000-0000-0000000b0001', 'WS-TODAY-0001', '00000000-0000-0000-0000-00000000c001', 'walk_in', public.today_mauritius(), 600000),
  ('00000000-0000-0000-0000-0000000b0002', 'WS-PAST-0001', '00000000-0000-0000-0000-00000000c001', 'walk_in', public.today_mauritius() - 1, 300000),
  ('00000000-0000-0000-0000-0000000b0003', 'WS-OTHER-0001', '00000000-0000-0000-0000-00000000c001', 'walk_in', public.today_mauritius(), 100000);
insert into public.payments (id, booking_id, amount_cents, method, received_from) values
  ('00000000-0000-0000-0000-00000000fa01', '00000000-0000-0000-0000-0000000b0001', 600000, 'cash', 'client');
insert into public.tickets (booking_id) values ('00000000-0000-0000-0000-0000000b0001');

-- Constraints
select throws_ok(
  $$insert into public.clients (first_name, last_name, phone_e164) values ('Dup', 'Licate', '+23057001234')$$,
  '23505', null, 'the same phone number cannot be registered twice');
select throws_ok(
  $$insert into public.clients (first_name, last_name, phone_e164) values ('Bad', 'Phone', '57001234')$$,
  '23514', null, 'a phone number must be stored in E.164 form');
select is((select search_text from public.clients where id = '00000000-0000-0000-0000-00000000c001'),
  'priya ramgoolam +23057001234 priya@example.com', 'search_text combines name, phone and email in lower case');
select throws_ok(
  $$insert into public.bookings (reference, client_id, source_type, service_date) values ('X', '00000000-0000-0000-0000-00000000c001', 'operator', current_date)$$,
  '23514', null, 'an operator booking needs an operator');
select throws_ok(
  $$insert into public.booking_items (booking_id, line_type, activity_id, participant_type, quantity, unit_retail_cents, unit_charged_cents, discount_cents)
    select '00000000-0000-0000-0000-0000000b0001', 'activity', gen_random_uuid(), 'adult', 1, 100, 100, 50$$,
  '23514', null, 'a discount needs a reason');
select matches((select token from public.tickets limit 1), '^[0-9a-f]{32}$', 'a ticket token is 16 random bytes in hex');

-- As a receptionist
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);

update public.bookings set notes = 'window seat' where id = '00000000-0000-0000-0000-0000000b0001';
select is((select notes from public.bookings where id = '00000000-0000-0000-0000-0000000b0001'), 'window seat',
  'reception can amend today''s booking');
update public.bookings set notes = 'changed' where id = '00000000-0000-0000-0000-0000000b0002';
select is((select notes from public.bookings where id = '00000000-0000-0000-0000-0000000b0002'), null,
  'reception cannot amend yesterday''s booking');
select throws_ok(
  $$update public.bookings set charged_total_cents = 1 where id = '00000000-0000-0000-0000-0000000b0001'$$,
  '42501', null, 'reception cannot edit a booking''s totals directly');
select throws_ok(
  $$update public.bookings set status = 'cancelled' where id = '00000000-0000-0000-0000-0000000b0003'$$,
  'P0001', 'Give a reason for cancelling this booking.', 'cancelling needs a reason');
update public.bookings set status = 'cancelled', cancellation_reason = 'Weather'
  where id = '00000000-0000-0000-0000-0000000b0003';
select results_eq(
  $$select cancelled_by, cancelled_at is not null from public.bookings where id = '00000000-0000-0000-0000-0000000b0003'$$,
  $$values ('00000000-0000-0000-0000-0000000000b2'::uuid, true)$$,
  'cancelling stamps who and when on the server');
update public.bookings set notes = 'after cancel' where id = '00000000-0000-0000-0000-0000000b0003';
select is((select notes from public.bookings where id = '00000000-0000-0000-0000-0000000b0003'), null,
  'reception cannot amend a cancelled booking');
select throws_ok(
  $$insert into public.bookings (reference, client_id, source_type, service_date) values ('Y', '00000000-0000-0000-0000-00000000c001', 'walk_in', current_date)$$,
  '42501', null, 'reception cannot insert a booking directly (create_booking does)');

insert into public.payments (booking_id, amount_cents, method, received_from)
  values ('00000000-0000-0000-0000-0000000b0003', 100000, 'card', 'client');
select results_eq(
  $$select recorded_by, received_at = now() from public.payments where booking_id = '00000000-0000-0000-0000-0000000b0003'$$,
  $$values ('00000000-0000-0000-0000-0000000000b2'::uuid, true)$$,
  'a payment is recorded in the actor''s name, at the current time');
select throws_ok(
  $$insert into public.payments (booking_id, amount_cents, method, received_from, received_at)
    values ('00000000-0000-0000-0000-0000000b0001', 100, 'cash', 'client', now() - interval '1 day')$$,
  '42501', null, 'reception cannot backdate a payment');
select throws_ok(
  $$insert into public.payments (booking_id, amount_cents, method, received_from) values ('00000000-0000-0000-0000-0000000b0001', -100, 'cash', 'client')$$,
  '23514', null, 'a negative amount must be a correction with a note');
select throws_ok(
  $$insert into public.payments (booking_id, amount_cents, method, received_from, is_correction, corrects_payment_id, note)
    values ('00000000-0000-0000-0000-0000000b0003', -600000, 'cash', 'client', true, '00000000-0000-0000-0000-00000000fa01', 'wrong booking')$$,
  'P0001', null, 'a correction must be on the same booking as the original');
select lives_ok(
  $$insert into public.payments (booking_id, amount_cents, method, received_from, is_correction, corrects_payment_id, note)
    values ('00000000-0000-0000-0000-0000000b0001', -600000, 'cash', 'client', true, '00000000-0000-0000-0000-00000000fa01', 'Entered twice')$$,
  'reception corrects a payment with a negative row');
select throws_ok($$delete from public.payments$$, '42501', null, 'reception cannot delete a payment');
select throws_ok($$update public.payments set amount_cents = 1$$, '42501', null, 'reception cannot edit a payment');
select throws_ok($$update public.tickets set token = 'guessable'$$, '42501', null, 'reception cannot change a ticket token');

-- As an accountant
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}', true);
select throws_ok(
  $$insert into public.payments (booking_id, amount_cents, method, received_from) values ('00000000-0000-0000-0000-0000000b0001', 100, 'cash', 'client')$$,
  '42501', null, 'an accountant cannot record a payment');

-- As activity staff
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d4","role":"authenticated"}', true);
select is(
  (select count(*) from public.bookings) + (select count(*) from public.clients) + (select count(*) from public.payments),
  0::bigint, 'activity staff read no bookings, clients or payments');

select * from finish();
rollback;
