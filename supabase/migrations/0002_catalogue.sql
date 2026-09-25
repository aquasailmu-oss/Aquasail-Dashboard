-- WP-03: audit infrastructure, then the sellable catalogue
-- (activities, packages, package_activities, tour_operators).

-- ---------------------------------------------------------------------------
-- Audit log. Written only by audit_trigger(); never updated or deleted by
-- anyone, admin included.
-- ---------------------------------------------------------------------------

create table public.audit_logs (
  id bigserial primary key,
  table_name text not null,
  record_id text,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  actor_id uuid,
  actor_role public.app_role,
  changed_at timestamptz not null default now(),
  old_data jsonb,
  new_data jsonb
);

create index audit_logs_record_idx on public.audit_logs (table_name, record_id);
create index audit_logs_changed_at_idx on public.audit_logs (changed_at);
create index audit_logs_actor_idx on public.audit_logs (actor_id);

-- Attach AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW. The optional trigger
-- argument names the key column for tables whose key is not `id`
-- (e.g. app_settings.key). actor_id is null for migrations, seeds and jobs.
create function public.audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := coalesce(tg_argv[0], 'id');
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
begin
  insert into public.audit_logs (table_name, record_id, action, actor_id, actor_role, old_data, new_data)
  values (
    tg_table_name,
    coalesce(v_new ->> v_key, v_old ->> v_key),
    tg_op,
    auth.uid(),
    public.auth_role(),
    v_old,
    v_new
  );
  return null;
end;
$$;

create function public.forbid_audit_log_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'The audit log cannot be changed or deleted.';
end;
$$;

-- Belt and braces on top of the grants below: blocks even the table owner.
create trigger audit_logs_immutable
  before update or delete on public.audit_logs
  for each row execute function public.forbid_audit_log_changes();

create trigger audit_logs_no_truncate
  before truncate on public.audit_logs
  for each statement execute function public.forbid_audit_log_changes();

alter table public.audit_logs enable row level security;
revoke all on table public.audit_logs from anon, authenticated;
grant select on table public.audit_logs to authenticated;

create policy "admins and accountants read the audit log"
  on public.audit_logs for select
  to authenticated
  using ((select public.has_role(array['admin', 'accountant']::public.app_role[])));

-- Profiles were created in WP-02; role changes and deactivations are audited from here on.
create trigger profiles_audit
  after insert or update or delete on public.profiles
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- Catalogue tables
-- ---------------------------------------------------------------------------

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  is_redeemable boolean not null default true,
  default_duration_minutes int check (default_duration_minutes > 0),
  sort_order int not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.packages (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  pricing_mode text not null check (pricing_mode in ('bundle', 'components')),
  sort_order int not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.package_activities (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.packages (id) on delete cascade,
  activity_id uuid not null references public.activities (id) on delete restrict,
  quantity_per_participant int not null default 1 check (quantity_per_participant > 0),
  is_optional boolean not null default false,
  sort_order int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (package_id, activity_id)
);

create index package_activities_activity_idx on public.package_activities (activity_id);

create table public.tour_operators (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  contact_name text,
  contact_phone text,
  contact_email text,
  settlement_model text not null check (settlement_model in ('net_rate', 'commission', 'none')),
  default_commission_rate numeric(5, 4) check (default_commission_rate >= 0 and default_commission_rate <= 1),
  payer text not null default 'client' check (payer in ('client', 'operator')),
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tour_operators_commission_needs_rate
    check (settlement_model <> 'commission' or default_commission_rate is not null)
);

create trigger activities_set_updated_at before update on public.activities
  for each row execute function public.set_updated_at();
create trigger packages_set_updated_at before update on public.packages
  for each row execute function public.set_updated_at();
create trigger package_activities_set_updated_at before update on public.package_activities
  for each row execute function public.set_updated_at();
create trigger tour_operators_set_updated_at before update on public.tour_operators
  for each row execute function public.set_updated_at();

create trigger activities_audit after insert or update or delete on public.activities
  for each row execute function public.audit_trigger();
create trigger packages_audit after insert or update or delete on public.packages
  for each row execute function public.audit_trigger();
create trigger package_activities_audit after insert or update or delete on public.package_activities
  for each row execute function public.audit_trigger();
create trigger tour_operators_audit after insert or update or delete on public.tour_operators
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- RLS. Read: any active staff member for the catalogue (it holds no prices);
-- tour_operators hold contact details, so activity_staff are excluded
-- (build plan §8). Write: admins only. No delete for anyone: deactivate.
-- ---------------------------------------------------------------------------

alter table public.activities enable row level security;
alter table public.packages enable row level security;
alter table public.package_activities enable row level security;
alter table public.tour_operators enable row level security;

revoke all on table public.activities, public.packages, public.package_activities, public.tour_operators
  from anon;
revoke delete, truncate on table public.activities, public.packages, public.package_activities, public.tour_operators
  from authenticated;

create policy "active staff read activities" on public.activities for select to authenticated
  using ((select public.auth_role()) is not null);
create policy "admins insert activities" on public.activities for insert to authenticated
  with check ((select public.is_admin()));
create policy "admins update activities" on public.activities for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "active staff read packages" on public.packages for select to authenticated
  using ((select public.auth_role()) is not null);
create policy "admins insert packages" on public.packages for insert to authenticated
  with check ((select public.is_admin()));
create policy "admins update packages" on public.packages for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "active staff read package activities" on public.package_activities for select to authenticated
  using ((select public.auth_role()) is not null);
create policy "admins insert package activities" on public.package_activities for insert to authenticated
  with check ((select public.is_admin()));
create policy "admins update package activities" on public.package_activities for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "office staff read tour operators" on public.tour_operators for select to authenticated
  using ((select public.has_role(array['admin', 'accountant', 'receptionist']::public.app_role[])));
create policy "admins insert tour operators" on public.tour_operators for insert to authenticated
  with check ((select public.is_admin()));
create policy "admins update tour operators" on public.tour_operators for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
