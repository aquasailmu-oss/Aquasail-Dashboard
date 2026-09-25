-- WP-13: set_prices_bulk() and price_rule_history().
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@test.local', '{"role":"admin","full_name":"Ada Admin"}'),
  ('00000000-0000-0000-0000-0000000000c3', 'acc@test.local', '{"role":"accountant","full_name":"Carl"}'),
  ('00000000-0000-0000-0000-0000000000b2', 'rec@test.local', '{"role":"receptionist","full_name":"Rita"}');
insert into public.activities (id, code, name) values
  ('00000000-0000-0000-0000-00000000ac01', 'T_A', 'A (test)'), ('00000000-0000-0000-0000-00000000ac02', 'T_B', 'B (test)');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

select is(public.set_prices_bulk(jsonb_build_array(
  jsonb_build_object('scope','activity','activity_id','00000000-0000-0000-0000-00000000ac01','audience','walk_in','participant_type','adult','retail_cents',100000,'effective_from',public.today_mauritius()),
  jsonb_build_object('scope','activity','activity_id','00000000-0000-0000-0000-00000000ac02','audience','walk_in','participant_type','adult','retail_cents',200000,'effective_from',public.today_mauritius())
)), 2, 'a bulk change applies every row');

select throws_ok(
  $$select public.set_prices_bulk(jsonb_build_array(
    jsonb_build_object('scope','activity','activity_id','00000000-0000-0000-0000-00000000ac01','audience','walk_in','participant_type','adult','retail_cents',110000,'effective_from',public.today_mauritius() + 7),
    jsonb_build_object('scope','activity','activity_id','00000000-0000-0000-0000-00000000ac02','audience','walk_in','participant_type','adult','retail_cents',210000,'effective_from',public.today_mauritius() - 1)))$$,
  'P0001', null, 'one bad row fails the whole bulk change');
select is(
  (select count(*)::int from public.price_rules where activity_id = '00000000-0000-0000-0000-00000000ac01'), 1,
  'and nothing from it was applied');

select public.set_prices_bulk(jsonb_build_array(
  jsonb_build_object('scope','activity','activity_id','00000000-0000-0000-0000-00000000ac01','audience','walk_in','participant_type','adult','retail_cents',110000,'effective_from',public.today_mauritius() + 7)));

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}', true);
select results_eq(
  $$select retail_cents, effective_from, effective_to, set_by from public.price_rule_history(p_activity_id => '00000000-0000-0000-0000-00000000ac01')$$,
  $$values (100000::bigint, public.today_mauritius(), public.today_mauritius() + 7, 'Ada Admin'::text),
           (110000::bigint, public.today_mauritius() + 7, null::date, 'Ada Admin'::text)$$,
  'an accountant sees the history, oldest first, with who set each price');
select throws_ok(
  $$select public.set_prices_bulk('[]'::jsonb)$$, 'P0001', 'Only an admin can change prices.', 'an accountant cannot bulk-change prices');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
select throws_ok(
  $$select * from public.price_rule_history(p_activity_id => '00000000-0000-0000-0000-00000000ac01')$$,
  'P0001', 'Only admins and accountants can see price history.', 'a receptionist cannot see price history');
select throws_ok(
  $$select public.set_prices_bulk('[]'::jsonb)$$, 'P0001', 'Only an admin can change prices.', 'a receptionist cannot bulk-change prices');

select * from finish();
rollback;
