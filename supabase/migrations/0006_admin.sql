-- WP-09: admin user management and settings.

-- ---------------------------------------------------------------------------
-- admin_list_users(): profiles joined to auth.users for the Users screen.
-- Emails live in auth.users, which the API cannot read; this exposes them
-- to admins only, without handing the page the service-role key.
-- ---------------------------------------------------------------------------

create function public.admin_list_users()
returns table (
  id uuid,
  email text,
  full_name text,
  role public.app_role,
  is_active boolean,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  invite_pending boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can list users.';
  end if;
  return query
    select p.id, u.email::text, p.full_name, p.role, p.is_active, p.created_at, u.last_sign_in_at,
           (u.invited_at is not null and u.last_sign_in_at is null)
    from public.profiles p
    join auth.users u on u.id = p.id
    order by p.is_active desc, p.full_name;
end;
$$;

revoke execute on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;

-- ---------------------------------------------------------------------------
-- Profile guard, extended: an admin cannot demote or deactivate themselves,
-- and nothing may leave the business without an active admin.
-- ---------------------------------------------------------------------------

create or replace function public.guard_profile_privileges()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if not public.is_admin() then
      if new.role is distinct from old.role then
        raise exception 'Only an admin can change a user''s role.';
      end if;
      if new.is_active is distinct from old.is_active then
        raise exception 'Only an admin can activate or deactivate a user.';
      end if;
    elsif new.id = auth.uid() and (new.role <> 'admin' or not new.is_active) then
      raise exception 'You cannot remove your own admin access. Ask another admin to do it.';
    end if;
  end if;

  if old.role = 'admin' and old.is_active and (new.role <> 'admin' or not new.is_active)
    and not exists (
      select 1 from public.profiles
      where role = 'admin' and is_active and id <> old.id
    ) then
    raise exception 'There must always be at least one active admin.';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Branding bucket for the company logo: public read (it is printed on
-- tickets), admin-only write. The app accepts PNG, JPEG and WebP up to 1 MB.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding', 'branding', true, 1048576, array['image/png', 'image/jpeg', 'image/webp']);

create policy "admins read branding files" on storage.objects for select to authenticated
  using (bucket_id = 'branding' and (select public.is_admin()));
create policy "admins upload branding files" on storage.objects for insert to authenticated
  with check (bucket_id = 'branding' and (select public.is_admin()));
create policy "admins replace branding files" on storage.objects for update to authenticated
  using (bucket_id = 'branding' and (select public.is_admin()))
  with check (bucket_id = 'branding' and (select public.is_admin()));
