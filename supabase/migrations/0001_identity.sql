-- WP-02: identity. Roles, profiles, the helpers every later RLS policy uses,
-- and the access-token hook that puts the role into the JWT.

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------

create type public.app_role as enum ('admin', 'accountant', 'receptionist', 'activity_staff');

-- ---------------------------------------------------------------------------
-- set_updated_at(): attached to every table with an updated_at column.
-- ---------------------------------------------------------------------------

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles: the application's view of an auth user. Never deleted; a leaver
-- is deactivated so their name stays readable on history and in the audit log.
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  role public.app_role not null default 'receptionist',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Creates the profile when an auth user is created (admin invite, WP-09).
-- Self-signup is disabled, so user metadata is set by an admin; an unknown or
-- missing role still falls back to the least-privileged staff role that can
-- use the app, rather than failing the invite.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.app_role := 'receptionist';
  v_name text;
begin
  if new.raw_user_meta_data ->> 'role' in ('admin', 'accountant', 'receptionist', 'activity_staff') then
    v_role := (new.raw_user_meta_data ->> 'role')::public.app_role;
  end if;

  v_name := nullif(trim(new.raw_user_meta_data ->> 'full_name'), '');
  if v_name is null then
    v_name := coalesce(split_part(new.email, '@', 1), 'New user');
  end if;

  insert into public.profiles (id, full_name, role) values (new.id, v_name, v_role);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Policy helpers. security definer so they can read profiles without
-- recursing through its RLS; empty search_path so nothing can shadow a name.
--
-- auth_role() reads the profile rather than trusting the JWT claim alone.
-- The claim can be up to an hour stale; the lookup is a primary-key read, and
-- it makes deactivation and role changes take effect immediately. An inactive
-- or missing profile yields null, so every has_role() check fails closed.
-- Policies should call these as (select public.is_admin()) so Postgres
-- evaluates them once per statement, not once per row.
-- ---------------------------------------------------------------------------

create function public.auth_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid() and p.is_active;
$$;

create function public.has_role(roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.auth_role() = any (roles), false);
$$;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_role(array['admin']::public.app_role[]);
$$;

revoke execute on function public.auth_role() from public, anon;
revoke execute on function public.has_role(public.app_role[]) from public, anon;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.auth_role() to authenticated;
grant execute on function public.has_role(public.app_role[]) to authenticated;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Custom access-token hook: adds `user_role` to the JWT so the app can route
-- by role without a query. Inactive users get no role claim.
--
-- SQL cannot switch the hook on. Local: supabase/config.toml already does.
-- Cloud: Supabase dashboard > Authentication > Hooks > "Customize Access Token
-- (JWT) Claims" > enable, type Postgres, schema public, function
-- custom_access_token_hook.
-- ---------------------------------------------------------------------------

create function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_claims jsonb := event -> 'claims';
  v_role public.app_role;
begin
  select p.role into v_role
  from public.profiles p
  where p.id = (event ->> 'user_id')::uuid and p.is_active;

  if v_role is null then
    v_claims := v_claims - 'user_role';
  else
    v_claims := jsonb_set(v_claims, '{user_role}', to_jsonb(v_role));
  end if;

  return jsonb_set(event, '{claims}', v_claims);
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant select on table public.profiles to supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- RLS on profiles
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;

revoke all on table public.profiles from anon;
-- No hard deletes (rule 8): no delete grant, and no delete policy below.
revoke delete, truncate on table public.profiles from authenticated;

create policy "auth admin reads profiles for the token hook"
  on public.profiles for select
  to supabase_auth_admin
  using (true);

-- Own row is readable even when inactive, so the app can explain a deactivation.
create policy "users read their own profile"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()));

create policy "admins read all profiles"
  on public.profiles for select
  to authenticated
  using ((select public.is_admin()));

create policy "active users update their own profile"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()) and is_active)
  with check (id = (select auth.uid()));

create policy "admins insert profiles"
  on public.profiles for insert
  to authenticated
  with check ((select public.is_admin()));

create policy "admins update profiles"
  on public.profiles for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- A policy cannot compare OLD with NEW, so this trigger stops a non-admin
-- from changing their own role or active flag through the self-update policy.
-- It only applies to API sessions; migrations, seeds and the service role
-- (current_user postgres / service_role) are trusted.
create function public.guard_profile_privileges()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') and not public.is_admin() then
    if new.role is distinct from old.role then
      raise exception 'Only an admin can change a user''s role.';
    end if;
    if new.is_active is distinct from old.is_active then
      raise exception 'Only an admin can activate or deactivate a user.';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_guard_privileges
  before update on public.profiles
  for each row execute function public.guard_profile_privileges();
