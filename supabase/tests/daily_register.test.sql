-- WP-17b: daily_register(), on a hand-worked day (seeded catalogue and prices).
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000b2', 'rec-reg@test.local', '{"role":"receptionist","full_name":"Rita"}'),
  ('00000000-0000-0000-0000-0000000000d4', 'staff-reg@test.local', '{"role":"activity_staff","full_name":"Sam"}');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);

create function pg_temp.book(p_key text, p_op text, p_boat text, p_lines jsonb, p_people int, p_paid bigint, p_discount jsonb default null) returns uuid
language plpgsql as $$
declare q jsonb; r jsonb;
begin
  q := public.build_quote(jsonb_strip_nulls(jsonb_build_object('service_date', '2098-03-10', 'operator_id',
         (select id from public.tour_operators where code = p_op), 'lines', p_lines, 'discount', p_discount)));
  r := public.create_booking(jsonb_strip_nulls(jsonb_build_object(
         'idempotency_key', 'reg-' || p_key, 'client', jsonb_build_object('first_name', 'Reg', 'last_name', p_key),
         'service_date', '2098-03-10', 'operator_id', (select id from public.tour_operators where code = p_op),
         'resource_id', (select id from public.resources where code = p_boat), 'lines', p_lines, 'discount', p_discount,
         'participants', jsonb_build_array(jsonb_build_object('participant_type', 'adult', 'count', p_people)),
         'payment', case when p_paid > 0 then jsonb_build_object('amount_cents', p_paid, 'method', 'cash') end,
         'expected_total_cents', (q ->> 'charged_total_cents')::bigint)));
  return (r ->> 'booking_id')::uuid;
end $$;
create function pg_temp.pkg(p_code text, p_qty int) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('target_type', 'package', 'target_id', (select id from public.packages where code = p_code), 'participant_type', 'adult', 'quantity', p_qty)) $$;
create function pg_temp.act(p_code text, p_qty int) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('target_type', 'activity', 'target_id', (select id from public.activities where code = p_code), 'participant_type', 'adult', 'quantity', p_qty)) $$;

select pg_temp.book('b1', null, 'CAT_A', pg_temp.pkg('ISLANDEXP', 2), 2, 640000);
select pg_temp.book('b2', null, null, pg_temp.pkg('ADRENALINE', 2), 2, 306000, '{"type":"percent","value":1000,"reason":"Family"}');
select pg_temp.book('b3', 'VERANDA', null, pg_temp.act('PARASAIL', 1), 1, 220000);
select pg_temp.book('b4', 'BEACHCOMB', 'CAT_B', pg_temp.pkg('SUNSET', 2), 2, 0);
create temp table cancelled as select pg_temp.book('b5', null, null, pg_temp.act('PARASAIL', 1), 1, 220000) as id;
grant all on cancelled to authenticated;
insert into public.payments (booking_id, amount_cents, method, received_from, is_correction, corrects_payment_id, note)
  select p.booking_id, -220000, 'cash', 'client', true, p.id, 'Refund: weather' from public.payments p where p.booking_id = (select id from cancelled);
update public.bookings set status = 'cancelled', cancellation_reason = 'Weather' where id = (select id from cancelled);

create temp table reg as select public.daily_register('2098-03-10') as r;
grant all on reg to authenticated;
create function pg_temp.row(p_label text) returns jsonb language sql as $$
  select x from reg, jsonb_array_elements(r -> 'rows') x where x ->> 'label' = p_label $$;

select is(pg_temp.row('Catamaran A'), '{"kind":"boat","label":"Catamaran A","pax":2,"amount_cents":640000}'::jsonb,
  'a paid boat booking: its full value goes to the vessel');
select is(pg_temp.row('Catamaran B'), '{"kind":"boat","label":"Catamaran B","pax":2,"amount_cents":0}'::jsonb,
  'an operator-account boat booking: people counted, nothing received');
select is(pg_temp.row('Parasailing'), '{"kind":"activity","label":"Parasailing","pax":3,"amount_cents":418000}'::jsonb,
  'parasailing: 2,200 × 2 × 0.9 discount × 0.5 paid + 2,200 fully paid = Rs 4,180; the cancelled one excluded');
select is(pg_temp.row('Tube Ride'), '{"kind":"activity","label":"Tube Ride","pax":2,"amount_cents":108000}'::jsonb,
  'tube: 1,200 × 2 × 0.9 × 0.5 = Rs 1,080');
select is(pg_temp.row('Beach BBQ Lunch') ->> 'pax', '0',
  'lunch on a boat booking is not counted again under activities');
select is(pg_temp.row('Catamaran Cruise'), null, 'the catamaran is covered by the boat rows, not listed as an activity');
select results_eq($$select (r ->> 'subtotal_pax')::int, (r ->> 'subtotal_cents')::bigint from reg$$,
  $$values (9, 1166000::bigint)$$, 'subtotal: 9 people, Rs 11,660');
select is((select (r ->> 'total_received_cents')::bigint from reg), 1166000::bigint,
  'total received, all methods, including the cancelled booking''s payment and refund: Rs 11,660');
select is((select x from reg, jsonb_array_elements(r -> 'operators') x where x ->> 'label' = 'Veranda Resorts') ->> 'amount_cents', '220000',
  'operator table: Veranda received Rs 2,200');
select is((select x from reg, jsonb_array_elements(r -> 'operators') x where x ->> 'label' = 'Beachcomber Hotel') ->> 'pax', '2',
  'operator table: Beachcomber 2 people on account');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d4","role":"authenticated"}', true);
select throws_ok($$select public.daily_register('2098-03-10')$$, 'P0001', 'Only office staff can see the daily register.',
  'activity staff cannot see the register');

select * from finish();
rollback;
