-- WP-09: user administration guards and admin_list_users().
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin1@test.local', '{"role":"admin","full_name":"Ada"}'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin2@test.local', '{"role":"admin","full_name":"Bea"}'),
  ('00000000-0000-0000-0000-0000000000b2', 'rec@test.local', '{"role":"receptionist","full_name":"Rita"}');
-- Only our two fixture admins are active admins in this transaction.
update public.profiles set is_active = false
  where role = 'admin' and id not in ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

select ok(
  (select count(*) from public.admin_list_users() where email = 'rec@test.local') = 1,
  'an admin lists users with their email');
select throws_ok(
  $$update public.profiles set is_active = false where id = '00000000-0000-0000-0000-0000000000a1'$$,
  'P0001', 'You cannot remove your own admin access. Ask another admin to do it.', 'an admin cannot deactivate themselves');
select throws_ok(
  $$update public.profiles set role = 'accountant' where id = '00000000-0000-0000-0000-0000000000a1'$$,
  'P0001', 'You cannot remove your own admin access. Ask another admin to do it.', 'an admin cannot demote themselves');
select lives_ok(
  $$update public.profiles set role = 'accountant' where id = '00000000-0000-0000-0000-0000000000a2'$$,
  'an admin can demote another admin');
select lives_ok(
  $$update public.profiles set full_name = 'Ada Lovelace' where id = '00000000-0000-0000-0000-0000000000a1'$$,
  'an admin can rename themselves');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
select throws_ok($$select * from public.admin_list_users()$$, 'P0001', 'Only an admin can list users.',
  'a receptionist cannot list users');

-- Even outside the API (a migration, a support session), the last admin stays.
reset role;
select throws_ok(
  $$update public.profiles set is_active = false where id = '00000000-0000-0000-0000-0000000000a1'$$,
  'P0001', 'There must always be at least one active admin.', 'the last active admin cannot be removed');

select * from finish();
rollback;
