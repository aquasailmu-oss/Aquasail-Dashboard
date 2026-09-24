-- Local development seed, run by `npm run db:reset` (never by db:push).
-- WP-19 extends this with the catalogue, prices and demo bookings.
--
-- Demo accounts, all with the password demo-password-1:
--   admin@aquasail.test      Admin
--   reception@aquasail.test  Receptionist
--   accounts@aquasail.test   Accountant
--   island@aquasail.test     Activity staff

-- A reset database has no users; a real one always has. Seeding demo
-- accounts into a database with users is refused (e.g. db push --include-seed).
do $$
begin
  if exists (select 1 from auth.users) then
    raise exception 'Refusing to seed: this database already has users. Demo data is for a freshly reset local database only.';
  end if;
end;
$$;
with demo (id, email, role, full_name) as (
  values
    ('00000000-0000-4000-8000-00000000d001'::uuid, 'admin@aquasail.test', 'admin', 'Ada Admin'),
    ('00000000-0000-4000-8000-00000000d002'::uuid, 'reception@aquasail.test', 'receptionist', 'Rita Ramsamy'),
    ('00000000-0000-4000-8000-00000000d003'::uuid, 'accounts@aquasail.test', 'accountant', 'Carl Accountant'),
    ('00000000-0000-4000-8000-00000000d004'::uuid, 'island@aquasail.test', 'activity_staff', 'Sam Island')
),
users as (
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new
  )
  select
    '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email,
    extensions.crypt('demo-password-1', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('role', role, 'full_name', full_name), now(), now(),
    '', '', '', ''
  from demo
  returning id, email
)
insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), id, id::text, jsonb_build_object('sub', id::text, 'email', email), 'email', now(), now(), now()
from users;
