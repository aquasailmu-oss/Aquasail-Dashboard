-- WP-04: price_rules constraints and set_price(). Run with `npm run test:db`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

-- Fixtures: an admin and a receptionist (the auth trigger creates profiles),
-- one activity, one components package, one operator.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@test.local', '{"role":"admin","full_name":"Ada"}'),
  ('00000000-0000-0000-0000-0000000000b2', 'rec@test.local', '{"role":"receptionist","full_name":"Rita"}');
insert into public.activities (id, code, name) values
  ('00000000-0000-0000-0000-00000000ac01', 'T_PRICING_CAT', 'Catamaran Cruise');
insert into public.packages (id, code, name, pricing_mode) values
  ('00000000-0000-0000-0000-00000000fa01', 'T_ADRENALINE', 'Adrenaline Combo', 'components');
insert into public.tour_operators (id, code, name, settlement_model) values
  ('00000000-0000-0000-0000-00000000de01', 'T_BEACH', 'Beachcomber Hotel', 'net_rate');

-- Direct inserts (as the migration owner) to exercise the constraints.
insert into public.price_rules (scope, activity_id, audience, participant_type, retail_cents, effective_from, effective_to)
values ('activity', '00000000-0000-0000-0000-00000000ac01', 'walk_in', 'adult', 170000, '2026-01-01', '2026-09-01');

select throws_ok(
  $$insert into public.price_rules (scope, activity_id, audience, participant_type, retail_cents, effective_from)
    values ('activity', '00000000-0000-0000-0000-00000000ac01', 'walk_in', 'adult', 180000, '2026-08-31')$$,
  '23P01', null, 'an overlapping price rule cannot be inserted');

select lives_ok(
  $$insert into public.price_rules (scope, activity_id, audience, participant_type, retail_cents, effective_from)
    values ('activity', '00000000-0000-0000-0000-00000000ac01', 'walk_in', 'child', 90000, '2026-08-31')$$,
  'the same dates for another participant type do not overlap');

select lives_ok(
  $$insert into public.price_rules (scope, activity_id, audience, operator_id, participant_type, retail_cents, net_cents, effective_from)
    values ('activity', '00000000-0000-0000-0000-00000000ac01', 'operator', '00000000-0000-0000-0000-00000000de01', 'adult', 170000, 120000, '2026-08-31')$$,
  'the same dates for an operator audience do not overlap the walk-in rule');

select throws_ok(
  $$insert into public.price_rules (scope, activity_id, package_id, audience, participant_type, retail_cents, effective_from)
    values ('activity', '00000000-0000-0000-0000-00000000ac01', '00000000-0000-0000-0000-00000000fa01', 'walk_in', 'adult', 1, '2030-01-01')$$,
  '23514', null, 'a rule cannot target both an activity and a package');

select throws_ok(
  $$insert into public.price_rules (scope, activity_id, audience, participant_type, retail_cents, effective_from)
    values ('activity', '00000000-0000-0000-0000-00000000ac01', 'operator', 'infant', 1, '2030-01-01')$$,
  '23514', null, 'an operator rule needs an operator');

-- As the admin, through the API role.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

select lives_ok(
  $$select public.set_price(p_scope => 'activity', p_audience => 'walk_in', p_participant_type => 'infant', p_retail_cents => 0, p_effective_from => public.today_mauritius(), p_activity_id => '00000000-0000-0000-0000-00000000ac01')$$,
  'admin sets a first price');

select public.set_price(p_scope => 'activity', p_audience => 'walk_in', p_participant_type => 'infant', p_retail_cents => 5000, p_effective_from => public.today_mauritius() + 10, p_activity_id => '00000000-0000-0000-0000-00000000ac01');

select results_eq(
  $$select retail_cents, effective_from, effective_to from public.price_rules
    where participant_type = 'infant' and activity_id = '00000000-0000-0000-0000-00000000ac01' order by effective_from$$,
  $$values (0::bigint, public.today_mauritius(), public.today_mauritius() + 10),
           (5000::bigint, public.today_mauritius() + 10, null::date)$$,
  'set_price closes the previous rule and inserts a new one, never updating the amount');

select throws_ok(
  $$select public.set_price(p_scope => 'activity', p_audience => 'walk_in', p_participant_type => 'infant', p_retail_cents => 6000, p_effective_from => public.today_mauritius() + 10, p_activity_id => '00000000-0000-0000-0000-00000000ac01')$$,
  'P0001', null, 'a new price must start after the current one');

select throws_ok(
  $$select public.set_price(p_scope => 'activity', p_audience => 'walk_in', p_participant_type => 'infant', p_retail_cents => 1, p_effective_from => public.today_mauritius() - 1, p_activity_id => '00000000-0000-0000-0000-00000000ac01')$$,
  'P0001', null, 'a price cannot be backdated');

select throws_ok(
  $$select public.set_price(p_scope => 'package', p_audience => 'walk_in', p_participant_type => 'adult', p_retail_cents => 1, p_effective_from => public.today_mauritius(), p_package_id => '00000000-0000-0000-0000-00000000fa01')$$,
  'P0001', 'This package is priced as the sum of its activities. Set the activity prices instead.',
  'a components package cannot be given its own price');

select is((select count(*) from public.price_rules where activity_id = '00000000-0000-0000-0000-00000000ac01')::int, 5,
  'admin reads price rules');

-- As the receptionist.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);

select throws_ok(
  $$select public.set_price(p_scope => 'activity', p_audience => 'walk_in', p_participant_type => 'infant', p_retail_cents => 1, p_effective_from => public.today_mauritius() + 30, p_activity_id => '00000000-0000-0000-0000-00000000ac01')$$,
  'P0001', 'Only an admin can change prices.', 'a non-admin calling set_price is rejected');

select is((select count(*) from public.price_rules)::int, 0, 'a receptionist reads no price rules');

select * from finish();
rollback;
