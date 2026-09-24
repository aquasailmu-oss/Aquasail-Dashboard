-- WP-11: save_package() and immutable codes.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@test.local', '{"role":"admin","full_name":"Ada"}'),
  ('00000000-0000-0000-0000-0000000000b2', 'rec@test.local', '{"role":"receptionist","full_name":"Rita"}');
insert into public.activities (id, code, name, is_active) values
  ('00000000-0000-0000-0000-00000000ac01', 'T_CAT', 'Catamaran (test)', true),
  ('00000000-0000-0000-0000-00000000ac02', 'T_SNORKEL', 'Snorkelling (test)', true),
  ('00000000-0000-0000-0000-00000000ac03', 'T_LUNCH', 'Lunch (test)', true),
  ('00000000-0000-0000-0000-00000000ac04', 'T_OLD', 'Retired (test)', false);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

create temp table ids (name text primary key, id uuid);
grant all on ids to authenticated;
insert into ids select 'pkg', public.save_package('{"code":"t_island","name":"Island (test)","pricing_mode":"bundle","activities":[
  {"activity_id":"00000000-0000-0000-0000-00000000ac01","quantity_per_participant":1},
  {"activity_id":"00000000-0000-0000-0000-00000000ac02","quantity_per_participant":1},
  {"activity_id":"00000000-0000-0000-0000-00000000ac03","quantity_per_participant":2,"is_optional":true}]}');

select results_eq(
  $$select p.code, a.code, pa.quantity_per_participant, pa.is_optional, pa.sort_order
    from public.packages p join public.package_activities pa on pa.package_id = p.id
    join public.activities a on a.id = pa.activity_id where p.id = (select id from ids) order by pa.sort_order$$,
  $$values ('T_ISLAND'::text, 'T_CAT'::text, 1, false, 10), ('T_ISLAND', 'T_SNORKEL', 1, false, 20), ('T_ISLAND', 'T_LUNCH', 2, true, 30)$$,
  'a new package is created with its activities in order, code upper-cased');

select public.save_package(jsonb_build_object('id', (select id from ids), 'name', 'Island Explorer (test)', 'pricing_mode', 'bundle',
  'activities', '[{"activity_id":"00000000-0000-0000-0000-00000000ac03","quantity_per_participant":1},
                  {"activity_id":"00000000-0000-0000-0000-00000000ac01","quantity_per_participant":1}]'::jsonb));
select results_eq(
  $$select a.code, pa.sort_order from public.package_activities pa join public.activities a on a.id = pa.activity_id
    where pa.package_id = (select id from ids) order by pa.sort_order$$,
  $$values ('T_LUNCH'::text, 10), ('T_CAT', 20)$$,
  'saving replaces the set: snorkelling removed, lunch moved first');

reset role;
select ok(
  exists (select 1 from public.audit_logs where table_name = 'package_activities' and action = 'DELETE'
          and old_data ->> 'activity_id' = '00000000-0000-0000-0000-00000000ac02'),
  'the removed activity is recorded in the audit log');
set local role authenticated;

select throws_ok(
  $$select public.save_package(jsonb_build_object('id', (select id from ids), 'name', 'X', 'pricing_mode', 'bundle', 'activities', '[]'::jsonb))$$,
  'P0001', 'Add at least one activity to the package.', 'a package needs an activity');
select throws_ok(
  $$select public.save_package('{"code":"T_DUP","name":"X","pricing_mode":"bundle","activities":[
     {"activity_id":"00000000-0000-0000-0000-00000000ac01","quantity_per_participant":1},
     {"activity_id":"00000000-0000-0000-0000-00000000ac01","quantity_per_participant":1}]}')$$,
  'P0001', 'An activity appears twice. Use its quantity instead.', 'duplicates are refused');
select throws_ok(
  $$select public.save_package('{"code":"T_NEW","name":"X","pricing_mode":"bundle","activities":[
     {"activity_id":"00000000-0000-0000-0000-00000000ac04","quantity_per_participant":1}]}')$$,
  'P0001', 'A deactivated activity cannot be added to a package.', 'deactivated activities cannot be added');
select throws_ok(
  $$select public.save_package('{"code":"T_ISLAND","name":"X","pricing_mode":"bundle","activities":[
     {"activity_id":"00000000-0000-0000-0000-00000000ac01","quantity_per_participant":1}]}')$$,
  'P0001', 'A package with the code T_ISLAND already exists.', 'package codes are unique, with a readable message');
select throws_ok(
  $$select public.save_package('{"code":"bad code!","name":"X","pricing_mode":"bundle","activities":[
     {"activity_id":"00000000-0000-0000-0000-00000000ac01","quantity_per_participant":1}]}')$$,
  'P0001', null, 'a malformed code is refused');
select throws_ok(
  $$select public.save_package('{"code":"T_Q","name":"X","pricing_mode":"bundle","activities":[
     {"activity_id":"00000000-0000-0000-0000-00000000ac01","quantity_per_participant":0}]}')$$,
  'P0001', 'Each activity needs a quantity of at least 1 per participant.', 'quantities are at least 1');

select throws_ok(
  $$update public.activities set code = 'T_RENAMED' where id = '00000000-0000-0000-0000-00000000ac01'$$,
  'P0001', null, 'an activity code cannot change');
select lives_ok(
  $$update public.activities set name = 'Catamaran Cruise (test)' where id = '00000000-0000-0000-0000-00000000ac01'$$,
  'other activity fields can change');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
select throws_ok(
  $$select public.save_package('{"code":"T_R","name":"X","pricing_mode":"bundle","activities":[
     {"activity_id":"00000000-0000-0000-0000-00000000ac01","quantity_per_participant":1}]}')$$,
  'P0001', 'Only an admin can change packages.', 'a receptionist cannot save packages');

select * from finish();
rollback;
