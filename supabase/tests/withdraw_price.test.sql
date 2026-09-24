-- withdraw_scheduled_price(): only unstarted, unused prices; the previous one is extended.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@test.local', '{"role":"admin","full_name":"Ada"}'),
  ('00000000-0000-0000-0000-0000000000b2', 'rec@test.local', '{"role":"receptionist","full_name":"Rita"}');
insert into public.activities (id, code, name) values ('00000000-0000-0000-0000-00000000ac01', 'T_W', 'Withdraw test');
insert into public.packages (id, code, name, pricing_mode) values ('00000000-0000-0000-0000-00000000fa01', 'T_WPKG', 'Components test', 'components');
insert into public.package_activities (package_id, activity_id) values ('00000000-0000-0000-0000-00000000fa01', '00000000-0000-0000-0000-00000000ac01');
insert into public.clients (id, first_name, last_name) values ('00000000-0000-0000-0000-00000000c001', 'W', 'Test');
insert into public.price_rules (id, scope, activity_id, audience, participant_type, retail_cents, effective_from, effective_to) values
  ('00000000-0000-0000-0000-0000000000e1', 'activity', '00000000-0000-0000-0000-00000000ac01', 'walk_in', 'adult', 100000, '2026-01-01', public.today_mauritius() + 10),
  ('00000000-0000-0000-0000-0000000000e2', 'activity', '00000000-0000-0000-0000-00000000ac01', 'walk_in', 'adult', 999900, public.today_mauritius() + 10, public.today_mauritius() + 20),
  ('00000000-0000-0000-0000-0000000000e3', 'activity', '00000000-0000-0000-0000-00000000ac01', 'walk_in', 'adult', 120000, public.today_mauritius() + 20, null);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
select throws_ok($$select public.withdraw_scheduled_price('00000000-0000-0000-0000-0000000000e2')$$, 'P0001', 'Only an admin can change prices.', 'a receptionist cannot withdraw prices');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select throws_ok($$select public.withdraw_scheduled_price('00000000-0000-0000-0000-0000000000e1')$$, 'P0001',
  'This price has already started. Set a new price from a later date instead.', 'a price that has started cannot be withdrawn');

-- A booking inside the scheduled price's dates, through a components package, blocks it.
reset role;
insert into public.bookings (id, reference, client_id, source_type, service_date) values
  ('00000000-0000-0000-0000-0000000b0001', 'W-1', '00000000-0000-0000-0000-00000000c001', 'walk_in', public.today_mauritius() + 12);
insert into public.booking_items (booking_id, line_type, package_id, participant_type, quantity, unit_retail_cents, unit_charged_cents) values
  ('00000000-0000-0000-0000-0000000b0001', 'package', '00000000-0000-0000-0000-00000000fa01', 'adult', 1, 999900, 999900);
set local role authenticated;
select throws_ok($$select public.withdraw_scheduled_price('00000000-0000-0000-0000-0000000000e2')$$, 'P0001',
  'Bookings already exist in this price''s dates. Set a new price from a later date instead.',
  'a booking in its dates (even via a components package) blocks withdrawal');

reset role;
update public.bookings set status = 'cancelled', cancelled_at = now(), cancellation_reason = 'test' where id = '00000000-0000-0000-0000-0000000b0001';
set local role authenticated;
select lives_ok($$select public.withdraw_scheduled_price('00000000-0000-0000-0000-0000000000e2')$$, 'with only a cancelled booking, the typo can be withdrawn');
select results_eq(
  $$select retail_cents, effective_from, effective_to from public.price_rules where activity_id = '00000000-0000-0000-0000-00000000ac01' order by effective_from$$,
  $$values (100000::bigint, '2026-01-01'::date, public.today_mauritius() + 20), (120000::bigint, public.today_mauritius() + 20, null::date)$$,
  'the previous price is extended over the gap, leaving no hole');
reset role;
select ok(exists (select 1 from public.audit_logs where table_name = 'price_rules' and action = 'DELETE'
  and record_id = '00000000-0000-0000-0000-0000000000e2'), 'the withdrawn price stays in the audit log');
set local role authenticated;
select lives_ok($$select public.withdraw_scheduled_price('00000000-0000-0000-0000-0000000000e3')$$, 'the last scheduled price can be withdrawn too');

select * from finish();
rollback;
