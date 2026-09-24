-- Hardening: never trust a role a user chose for themselves.
--
-- handle_new_user() took the role from raw_user_meta_data, which the person
-- signing up controls. With self-signup disabled only admins create users,
-- but if signup were ever switched on (the cloud project had it on by
-- default), anyone with the public key could sign up as 'admin'.
--
-- Now the metadata is trusted only when the account came from an admin
-- invite (auth.users.invited_at is set) or was inserted directly by the
-- database owner (seeds, tests). Any other new account gets an inactive
-- receptionist profile, which RLS denies everywhere until an admin
-- reviews and activates it on the Users screen.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- session_user, not current_user: this function is security definer.
  -- The auth service connects as supabase_auth_admin; seeds run as postgres.
  v_trusted boolean := new.invited_at is not null or session_user = 'postgres';
  v_role public.app_role := 'receptionist';
  v_name text;
begin
  if v_trusted and new.raw_user_meta_data ->> 'role' in ('admin', 'accountant', 'receptionist', 'activity_staff') then
    v_role := (new.raw_user_meta_data ->> 'role')::public.app_role;
  end if;

  v_name := nullif(trim(new.raw_user_meta_data ->> 'full_name'), '');
  if v_name is null then
    v_name := coalesce(split_part(new.email, '@', 1), 'New user');
  end if;

  insert into public.profiles (id, full_name, role, is_active)
  values (new.id, v_name, v_role, v_trusted);
  return new;
end;
$$;

-- The auth service inserts an invited user first and sets invited_at in a
-- follow-up update, so the insert trigger sees an untrusted account. When
-- invited_at is first set (only an admin invite does that), apply the role
-- the admin chose and activate the profile.
create function public.handle_user_invited()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set role = case
        when new.raw_user_meta_data ->> 'role' in ('admin', 'accountant', 'receptionist', 'activity_staff')
          then (new.raw_user_meta_data ->> 'role')::public.app_role
        else 'receptionist'
      end,
      is_active = true
  where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_invited
  after update of invited_at on auth.users
  for each row
  when (old.invited_at is null and new.invited_at is not null)
  execute function public.handle_user_invited();
