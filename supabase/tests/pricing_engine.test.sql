-- WP-14: build_quote(), the pricing engine. Every case the build plan makes
-- mandatory, run against the real engine.
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@test.local', '{"role":"admin","full_name":"Ada"}'),
  ('00000000-0000-0000-0000-0000000000b2', 'rec@test.local', '{"role":"receptionist","full_name":"Rita"}'),
  ('00000000-0000-0000-0000-0000000000d4', 'staff@test.local', '{"role":"activity_staff","full_name":"Sam"}');
insert into public.activities (id, code, name) values
  ('00000000-0000-0000-0000-00000000ac01', 'T_CAT', 'Catamaran'),
  ('00000000-0000-0000-0000-00000000ac02', 'T_PARA', 'Parasailing'),
  ('00000000-0000-0000-0000-00000000ac03', 'T_TUBE', 'Tube Ride'),
  ('00000000-0000-0000-0000-00000000ac04', 'T_LUNCH', 'Lunch');
insert into public.activities (id, code, name, is_active) values ('00000000-0000-0000-0000-00000000ac09', 'T_OLD', 'Retired', false);
insert into public.packages (id, code, name, pricing_mode) values
  ('00000000-0000-0000-0000-00000000fa01', 'T_ISLAND', 'Island Explorer', 'bundle'),
  ('00000000-0000-0000-0000-00000000fa02', 'T_ADREN', 'Adrenaline Combo', 'components');
insert into public.package_activities (package_id, activity_id, quantity_per_participant, is_optional) values
  ('00000000-0000-0000-0000-00000000fa01', '00000000-0000-0000-0000-00000000ac01', 1, false),
  ('00000000-0000-0000-0000-00000000fa01', '00000000-0000-0000-0000-00000000ac04', 1, false),
  ('00000000-0000-0000-0000-00000000fa02', '00000000-0000-0000-0000-00000000ac02', 1, false),
  ('00000000-0000-0000-0000-00000000fa02', '00000000-0000-0000-0000-00000000ac03', 2, false),
  ('00000000-0000-0000-0000-00000000fa02', '00000000-0000-0000-0000-00000000ac04', 1, true);
insert into public.tour_operators (id, code, name, settlement_model, default_commission_rate, payer) values
  ('00000000-0000-0000-0000-00000000de01', 'T_BEACH', 'Beachcomber', 'net_rate', null, 'operator'),
  ('00000000-0000-0000-0000-00000000de02', 'T_VER', 'Veranda', 'commission', 0.2000, 'client'),
  ('00000000-0000-0000-0000-00000000de03', 'T_HERIT', 'Heritage', 'net_rate', null, 'client');

-- Catamaran adult walk-in: 1,700 until 31 Aug 2026, 1,800 in Sep, 1,950 from 1 Oct.
insert into public.price_rules (scope, activity_id, package_id, audience, operator_id, participant_type, retail_cents, net_cents, commission_rate, effective_from, effective_to) values
  ('activity', '00000000-0000-0000-0000-00000000ac01', null, 'walk_in', null, 'adult', 170000, null, null, '2026-01-01', '2026-09-01'),
  ('activity', '00000000-0000-0000-0000-00000000ac01', null, 'walk_in', null, 'adult', 180000, null, null, '2026-09-01', '2026-10-01'),
  ('activity', '00000000-0000-0000-0000-00000000ac01', null, 'walk_in', null, 'adult', 195000, null, null, '2026-10-01', null),
  ('activity', '00000000-0000-0000-0000-00000000ac01', null, 'operator', '00000000-0000-0000-0000-00000000de01', 'adult', 180000, 120000, null, '2026-01-01', null),
  ('activity', '00000000-0000-0000-0000-00000000ac02', null, 'walk_in', null, 'adult', 220000, null, null, '2026-01-01', null),
  ('activity', '00000000-0000-0000-0000-00000000ac02', null, 'operator', '00000000-0000-0000-0000-00000000de02', 'adult', 133333, null, 0.1550, '2026-01-01', null),
  ('activity', '00000000-0000-0000-0000-00000000ac03', null, 'walk_in', null, 'adult', 120000, null, null, '2026-01-01', null),
  ('activity', '00000000-0000-0000-0000-00000000ac04', null, 'walk_in', null, 'adult', 85000, null, null, '2026-01-01', null),
  ('package', null, '00000000-0000-0000-0000-00000000fa01', 'walk_in', null, 'adult', 250000, null, null, '2026-01-01', null);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);

create function pg_temp.q(p_date text, p_op text, p_lines jsonb, p_discount jsonb default null) returns jsonb
language sql as $$
  select public.build_quote(jsonb_strip_nulls(jsonb_build_object('service_date', p_date, 'operator_id', p_op, 'lines', p_lines, 'discount', p_discount)))
$$;
create function pg_temp.act(p_id text, p_type text default 'adult', p_qty int default 1) returns jsonb
language sql as $$ select jsonb_build_array(jsonb_build_object('target_type','activity','target_id',p_id,'participant_type',p_type,'quantity',p_qty)) $$;
create function pg_temp.pkg(p_id text, p_type text default 'adult', p_qty int default 1) returns jsonb
language sql as $$ select jsonb_build_array(jsonb_build_object('target_type','package','target_id',p_id,'participant_type',p_type,'quantity',p_qty)) $$;

-- 1. Resolution order
select is((pg_temp.q('2026-09-17', '00000000-0000-0000-0000-00000000de01', pg_temp.act('00000000-0000-0000-0000-00000000ac01')) #>> '{lines,0,unit_retail_cents}')::bigint,
  180000::bigint, 'an operator-specific price is used for that operator');
select is((pg_temp.q('2026-09-17', '00000000-0000-0000-0000-00000000de02', pg_temp.act('00000000-0000-0000-0000-00000000ac01')) #>> '{lines,0,unit_retail_cents}')::bigint,
  180000::bigint, 'with no operator price, the walk-in price applies');
select is((pg_temp.q('2026-09-17', '00000000-0000-0000-0000-00000000de02', pg_temp.act('00000000-0000-0000-0000-00000000ac02')) #>> '{lines,0,unit_retail_cents}')::bigint,
  133333::bigint, 'the operator price beats the walk-in price (Rs 1,333.33 vs Rs 2,200)');

-- 2. Date boundaries: effective_to is exclusive
select is((pg_temp.q('2026-09-30', null, pg_temp.act('00000000-0000-0000-0000-00000000ac01')) ->> 'charged_total_cents')::bigint,
  180000::bigint, 'the day before a price change: old price');
select is((pg_temp.q('2026-10-01', null, pg_temp.act('00000000-0000-0000-0000-00000000ac01')) ->> 'charged_total_cents')::bigint,
  195000::bigint, 'the day a price change starts: new price');
select is((pg_temp.q('2026-10-02', null, pg_temp.act('00000000-0000-0000-0000-00000000ac01')) ->> 'charged_total_cents')::bigint,
  195000::bigint, 'the day after: new price');
select is((pg_temp.q('2026-06-15', null, pg_temp.act('00000000-0000-0000-0000-00000000ac01')) ->> 'charged_total_cents')::bigint,
  170000::bigint, 'a past service date gets that date''s historical price, not today''s');

-- 3. Missing prices are errors, never zero
select throws_ok($$select pg_temp.q('2026-09-17', null, pg_temp.act('00000000-0000-0000-0000-00000000ac01', 'child'))$$,
  'P0001', 'No price configured for Catamaran / child on 17 Sep 2026. Ask an admin to set it.',
  'a missing price names the item, participant type and date');
select throws_ok($$select pg_temp.q('2025-12-31', null, pg_temp.act('00000000-0000-0000-0000-00000000ac01'))$$,
  'P0001', 'No price configured for Catamaran / adult on 31 Dec 2025. Ask an admin to set it.',
  'before the first price there is no price');
select throws_ok($$select pg_temp.q('2026-09-17', null, pg_temp.pkg('00000000-0000-0000-0000-00000000fa02', 'child'))$$,
  'P0001', 'No price configured for Parasailing / child on 17 Sep 2026. Ask an admin to set it.',
  'a components package names the unpriced activity');

-- 4. Packages
select is((pg_temp.q('2026-09-17', null, pg_temp.pkg('00000000-0000-0000-0000-00000000fa01', 'adult', 4)) ->> 'charged_total_cents')::bigint,
  1000000::bigint, 'a bundle package uses its own price (4 × Rs 2,500)');
select is((pg_temp.q('2026-09-17', null, pg_temp.pkg('00000000-0000-0000-0000-00000000fa02')) #>> '{lines,0,unit_retail_cents}')::bigint,
  460000::bigint, 'a components package sums its non-optional activities × quantity (2,200 + 2 × 1,200; optional lunch excluded)');
select is(pg_temp.q('2026-09-17', null, pg_temp.pkg('00000000-0000-0000-0000-00000000fa01')) #> '{lines,0,includes}',
  '["Catamaran", "Lunch"]'::jsonb, 'a quote lists what a package includes');

-- 5. Settlement: net rate
select results_eq(
  $$select (l ->> 'unit_retail_cents')::bigint, (l ->> 'unit_charged_cents')::bigint, (l ->> 'unit_operator_net_cents')::bigint, (l ->> 'commission_cents')::bigint
    from jsonb_array_elements(pg_temp.q('2026-09-17', '00000000-0000-0000-0000-00000000de01', pg_temp.act('00000000-0000-0000-0000-00000000ac01', 'adult', 3)) -> 'lines') l$$,
  $$values (180000::bigint, 120000::bigint, 120000::bigint, 0::bigint)$$,
  'net rate: charged = net, retail kept for reference, no commission');
select is((pg_temp.q('2026-09-17', '00000000-0000-0000-0000-00000000de01', pg_temp.act('00000000-0000-0000-0000-00000000ac01', 'adult', 3)) ->> 'operator_net_total_cents')::bigint,
  360000::bigint, 'net rate: the operator net total is recorded');
select results_eq(
  $$select (q #>> '{lines,0,unit_charged_cents}')::bigint, q #>> '{warnings,0}'
    from pg_temp.q('2026-09-17', '00000000-0000-0000-0000-00000000de03', pg_temp.act('00000000-0000-0000-0000-00000000ac02')) q$$,
  $$values (220000::bigint, 'No net price for Parasailing / adult with Heritage: charged at retail.'::text)$$,
  'net rate with no net price: charged at retail, with a warning');

-- 6. Settlement: commission, and rounding of an odd commission
select results_eq(
  $$select (l ->> 'unit_charged_cents')::bigint, (l ->> 'commission_cents')::bigint, (l ->> 'commission_rate')::numeric
    from jsonb_array_elements(pg_temp.q('2026-09-17', '00000000-0000-0000-0000-00000000de02', pg_temp.act('00000000-0000-0000-0000-00000000ac01', 'adult', 3)) -> 'lines') l$$,
  $$values (180000::bigint, 108000::bigint, 0.2000::numeric)$$,
  'commission: charged = retail, commission = retail × operator default rate (3 × 1,800 × 20%)');
select is((pg_temp.q('2026-09-17', '00000000-0000-0000-0000-00000000de02', pg_temp.act('00000000-0000-0000-0000-00000000ac02')) #>> '{lines,0,commission_cents}')::bigint,
  20667::bigint, 'a rule''s own rate wins, and 133,333 × 15.5% = 20,666.615 rounds half-up to 20,667 cents');
select is((pg_temp.q('2026-09-17', '00000000-0000-0000-0000-00000000de02', pg_temp.act('00000000-0000-0000-0000-00000000ac02', 'adult', 3)) #>> '{lines,0,commission_cents}')::bigint,
  62000::bigint, 'commission is rounded per line (399,999 × 15.5% = 61,999.845 → 62,000), not per unit then multiplied');

-- 7. Payer
select is(pg_temp.q('2026-09-17', '00000000-0000-0000-0000-00000000de01', pg_temp.act('00000000-0000-0000-0000-00000000ac01')) ->> 'payer',
  'operator', 'payer comes from the operator');
select is(pg_temp.q('2026-09-17', null, pg_temp.act('00000000-0000-0000-0000-00000000ac01')) ->> 'payer',
  'client', 'walk-ins pay at reception');

-- 8. Discounts
select results_eq(
  $$select (q ->> 'discount_total_cents')::bigint, (q ->> 'charged_total_cents')::bigint,
           (select sum((l ->> 'discount_cents')::bigint) from jsonb_array_elements(q -> 'lines') l)::bigint
    from pg_temp.q('2026-09-17', null,
      pg_temp.act('00000000-0000-0000-0000-00000000ac01', 'adult', 1) || pg_temp.act('00000000-0000-0000-0000-00000000ac03', 'adult', 1) || pg_temp.act('00000000-0000-0000-0000-00000000ac04', 'adult', 1),
      '{"type":"percent","value":1000,"reason":"Birthday"}') q$$,
  $$values (38500::bigint, 346500::bigint, 38500::bigint)$$,
  'a 10% discount applies to the charged total and the line shares add up exactly');
select results_eq(
  $$select (l ->> 'discount_cents')::bigint
    from jsonb_array_elements(pg_temp.q('2026-09-17', null,
      pg_temp.act('00000000-0000-0000-0000-00000000ac04', 'adult', 1) || pg_temp.act('00000000-0000-0000-0000-00000000ac04', 'adult', 1) || pg_temp.act('00000000-0000-0000-0000-00000000ac04', 'adult', 1),
      '{"type":"amount","value":100,"reason":"Rounding"}') -> 'lines') l$$,
  $$values (34::bigint), (33::bigint), (33::bigint)$$,
  'an amount that does not divide evenly is spread by largest remainder');
select throws_ok(
  $$select pg_temp.q('2026-09-17', null, pg_temp.act('00000000-0000-0000-0000-00000000ac01'), '{"type":"percent","value":3000,"reason":"Friend"}')$$,
  'P0001', 'Reception can give at most 10% discount (Rs 180 on this booking). Ask an admin for more.',
  'a receptionist''s discount above the cap is refused with a readable message');
select throws_ok(
  $$select pg_temp.q('2026-09-17', null, pg_temp.act('00000000-0000-0000-0000-00000000ac01'), '{"type":"amount","value":5000}')$$,
  'P0001', 'Give a reason for the discount.', 'a discount needs a reason');
select throws_ok(
  $$select pg_temp.q('2026-09-17', null, pg_temp.act('00000000-0000-0000-0000-00000000ac01'), '{"type":"amount","value":999999,"reason":"x"}')$$,
  'P0001', 'The discount is larger than the price.', 'a discount cannot exceed the price');

select throws_ok($$select pg_temp.q('2026-09-17', null, pg_temp.act('00000000-0000-0000-0000-00000000ac09'))$$,
  'P0001', 'Retired is no longer on sale.', 'deactivated items cannot be quoted');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select is((pg_temp.q('2026-09-17', null, pg_temp.act('00000000-0000-0000-0000-00000000ac01'), '{"type":"percent","value":3000,"reason":"Owner''s friend"}') ->> 'charged_total_cents')::bigint,
  126000::bigint, 'an admin''s 30% discount is allowed');

reset role;
update public.app_settings set value = '15' where key = 'max_discount_percent_receptionist';
insert into public.app_settings (key, value) select 'max_discount_percent_receptionist', '15'
  where not exists (select 1 from public.app_settings where key = 'max_discount_percent_receptionist');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
select lives_ok($$select pg_temp.q('2026-09-17', null, pg_temp.act('00000000-0000-0000-0000-00000000ac01'), '{"type":"percent","value":1500,"reason":"Regular"}')$$,
  'the receptionist cap follows the setting (15% allowed once set to 15)');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d4","role":"authenticated"}', true);
select throws_ok($$select pg_temp.q('2026-09-17', null, pg_temp.act('00000000-0000-0000-0000-00000000ac01'))$$,
  'P0001', 'Only office staff can price bookings.', 'activity staff cannot price anything');

select * from finish();
rollback;
