-- WP-22 (V2): ticketing and redemption schema. Where a redemption happened,
-- which device recorded it, the redemption event log itself, the delivery log,
-- ticket revocation, and party check-in. The functions that write these
-- (redeem_activity, check_in_booking, scan_ticket, ...) arrive in WP-23/24;
-- until then nobody but the database owner writes to the new tables.
--
-- activity_staff and activity_supervisor get no read access to any table
-- here except locations (a handful of place names). Everything else they
-- touch goes through security definer functions with narrow payloads: that
-- boundary is what V2 depends on (V2 plan §10.2).

-- ---------------------------------------------------------------------------
-- Sign-up: accept the new role from an admin invite. Built from the enum
-- rather than a list, so a future role cannot silently fall back to
-- receptionist the way activity_supervisor would have.
-- ---------------------------------------------------------------------------

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
  if v_trusted and new.raw_user_meta_data ->> 'role' = any (enum_range(null::public.app_role)::text[]) then
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

create or replace function public.handle_user_invited()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set role = case
        when new.raw_user_meta_data ->> 'role' = any (enum_range(null::public.app_role)::text[])
          then (new.raw_user_meta_data ->> 'role')::public.app_role
        else 'receptionist'
      end,
      is_active = true
  where id = new.id;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- locations: where a check-in or redemption happened. Three or four rows,
-- inserted here because there is no screen for them and production needs
-- them as much as a local database does.
-- ---------------------------------------------------------------------------

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  location_type text not null check (location_type in ('reception', 'island', 'jetty', 'vessel')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger locations_set_updated_at before update on public.locations
  for each row execute function public.set_updated_at();
create trigger locations_audit after insert or update or delete on public.locations
  for each row execute function public.audit_trigger();

insert into public.locations (code, name, location_type) values
  ('RECEPTION', 'Reception', 'reception'),
  ('ISLAND', 'Ile aux Cerfs', 'island'),
  ('JETTY', 'Jetty', 'jetty')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- staff_devices: the offline unit of accountability (V2 plan §3.1). The
-- device proves itself with a secret only its hash is stored for.
-- Deactivating a device is how a lost tablet is dealt with.
-- ---------------------------------------------------------------------------

create table public.staff_devices (
  id uuid primary key default gen_random_uuid(),
  label text not null check (nullif(trim(label), '') is not null), -- "Island tablet 1"
  location_id uuid references public.locations (id),
  device_secret_hash text not null,
  registered_by uuid references public.profiles (id),
  registered_at timestamptz not null default now(),
  last_seen_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index staff_devices_active_label_idx on public.staff_devices (lower(label)) where is_active;

create trigger staff_devices_set_updated_at before update on public.staff_devices
  for each row execute function public.set_updated_at();
-- Not on last_seen_at: every sync touches it, and the audit log would drown.
create trigger staff_devices_audit
  after insert or delete or update of label, location_id, device_secret_hash, is_active on public.staff_devices
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- ticket_redemptions: the event log. Never deleted; a mistake is reversed by
-- a negative row that references the original, as payments are corrected.
-- The no-over-redemption rule spans rows, so no constraint can express it:
-- it lives in redeem_activity() (WP-23), which locks the entitlement row.
-- ---------------------------------------------------------------------------

create table public.ticket_redemptions (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete restrict,
  booking_activity_id uuid not null references public.booking_activities (id) on delete restrict,
  activity_id uuid not null references public.activities (id),
  quantity_redeemed int not null check (quantity_redeemed <> 0), -- negative for a reversal
  redeemed_at timestamptz not null default now(),
  occurred_at_device timestamptz, -- when the device says it happened
  synced_at timestamptz not null default now(),
  redeemed_by uuid references public.profiles (id),
  device_id uuid references public.staff_devices (id),
  location_id uuid references public.locations (id),
  -- The idempotency key, generated on the device before the attempt. Its
  -- unique index is what makes a retry after a dropped connection harmless.
  client_uuid uuid not null,
  is_reversal boolean not null default false,
  reverses_redemption_id uuid references public.ticket_redemptions (id),
  is_over_redemption boolean not null default false,
  is_provisional boolean not null default false,
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  review_note text,
  note text,

  constraint ticket_redemptions_reversal_shape check (
    is_reversal = (quantity_redeemed < 0)
    and is_reversal = (reverses_redemption_id is not null)
  ),
  constraint ticket_redemptions_reversal_reason check (
    not is_reversal or nullif(trim(note), '') is not null
  ),
  constraint ticket_redemptions_review_complete check (
    (reviewed_at is null) = (reviewed_by is null)
  )
);

create unique index ticket_redemptions_client_uuid_idx on public.ticket_redemptions (client_uuid);
-- A redemption is reversed at most once.
create unique index ticket_redemptions_reverses_idx on public.ticket_redemptions (reverses_redemption_id)
  where reverses_redemption_id is not null;
create index ticket_redemptions_booking_idx on public.ticket_redemptions (booking_id);
create index ticket_redemptions_booking_activity_idx on public.ticket_redemptions (booking_activity_id);
create index ticket_redemptions_redeemed_at_idx on public.ticket_redemptions (redeemed_at);
create index ticket_redemptions_flagged_idx on public.ticket_redemptions (redeemed_at)
  where is_over_redemption or is_provisional;

-- The log is append-only. Only the review fields may be filled in, once.
create function public.guard_redemption_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'A redemption is never deleted. Reverse it instead.';
  end if;
  if (to_jsonb(new) - array['reviewed_by', 'reviewed_at', 'review_note'])
     is distinct from (to_jsonb(old) - array['reviewed_by', 'reviewed_at', 'review_note']) then
    raise exception 'A redemption cannot be changed. Reverse it instead.';
  end if;
  if old.reviewed_at is not null then
    raise exception 'This redemption has already been reviewed.';
  end if;
  return new;
end;
$$;

create trigger ticket_redemptions_guard before update or delete on public.ticket_redemptions
  for each row execute function public.guard_redemption_changes();
create trigger ticket_redemptions_no_truncate before truncate on public.ticket_redemptions
  for each statement execute function public.guard_redemption_changes();
create trigger ticket_redemptions_audit after insert or update or delete on public.ticket_redemptions
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- message_log: every delivery attempt, written before the provider is called
-- and updated with its result (V2 plan §9.2). A "sent" that silently failed
-- is worse than no feature.
-- ---------------------------------------------------------------------------

create table public.message_log (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete restrict,
  ticket_id uuid references public.tickets (id),
  channel text not null check (channel in ('whatsapp', 'email')),
  template text,
  to_address text,
  status text not null default 'queued' check (status in ('queued', 'sent', 'delivered', 'read', 'failed')),
  provider text,
  provider_message_id text,
  error_code text,
  error_detail text,
  attempt int not null default 1 check (attempt > 0),
  sent_by uuid references public.profiles (id),
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  cost_cents bigint check (cost_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index message_log_booking_idx on public.message_log (booking_id);
create index message_log_status_idx on public.message_log (status);
create index message_log_provider_message_idx on public.message_log (provider_message_id);

create trigger message_log_set_updated_at before update on public.message_log
  for each row execute function public.set_updated_at();
create trigger message_log_audit after insert or update or delete on public.message_log
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- tickets: revocation and reissue. token_hash is what the offline manifest
-- carries: a lost device must not hold working ticket URLs (V2 plan §7.1).
-- A ticket's state is derived, never stored (§5.1).
-- ---------------------------------------------------------------------------

alter table public.tickets
  add column revoked_at timestamptz,
  add column revoked_by uuid references public.profiles (id),
  add column revoke_reason text,
  add column reissued_from_ticket_id uuid references public.tickets (id),
  add column token_hash text generated always as (encode(extensions.digest(token, 'sha256'), 'hex')) stored,
  add column delivered_channels jsonb not null default '[]',
  add constraint tickets_revoked_has_reason check (
    revoked_at is null or nullif(trim(revoke_reason), '') is not null
  );

create index tickets_token_hash_idx on public.tickets (token_hash);

-- ---------------------------------------------------------------------------
-- bookings: party check-in, a separate event from redemption (V2 plan §3.2).
-- Null means the party has not arrived, which is what makes no-shows countable.
-- Not in the hand-editable column grant: only check_in_booking() sets these.
-- ---------------------------------------------------------------------------

alter table public.bookings
  add column checked_in_at timestamptz,
  add column checked_in_by uuid references public.profiles (id),
  add column checked_in_device_id uuid references public.staff_devices (id),
  add column checked_in_location_id uuid references public.locations (id);

-- ---------------------------------------------------------------------------
-- Grants and RLS. Nothing is deleted by anyone; anon gets nothing. The event
-- tables are written only by the WP-23/24 functions and, for message_log,
-- by the delivery actions of WP-31/32, which add their own grants.
-- ---------------------------------------------------------------------------

revoke all on table public.locations, public.staff_devices, public.ticket_redemptions, public.message_log
  from anon, authenticated;

grant select on table public.locations, public.ticket_redemptions, public.message_log to authenticated;
grant insert (code, name, location_type), update (name, location_type, is_active)
  on table public.locations to authenticated;
-- Every column but the secret's hash.
grant select (id, label, location_id, registered_by, registered_at, last_seen_at, is_active, created_at, updated_at)
  on table public.staff_devices to authenticated;
grant update (label, location_id, is_active) on table public.staff_devices to authenticated;

alter table public.locations enable row level security;
alter table public.staff_devices enable row level security;
alter table public.ticket_redemptions enable row level security;
alter table public.message_log enable row level security;

-- locations: every active role, island staff included (they are place names).
create policy "active staff read locations" on public.locations for select to authenticated
  using ((select public.auth_role()) is not null);
create policy "admins add locations" on public.locations for insert to authenticated
  with check ((select public.is_admin()));
create policy "admins update locations" on public.locations for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- staff_devices: registration goes through a function (WP-27); supervisors
-- see their devices through functions too (WP-30).
create policy "admins and accountants read devices" on public.staff_devices for select to authenticated
  using ((select public.has_role(array['admin', 'accountant']::public.app_role[])));
create policy "admins update devices" on public.staff_devices for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ticket_redemptions and message_log: office staff read; nobody writes directly.
create policy "office staff read redemptions" on public.ticket_redemptions for select to authenticated
  using ((select public.has_role(array['admin', 'accountant', 'receptionist']::public.app_role[])));
create policy "office staff read the message log" on public.message_log for select to authenticated
  using ((select public.has_role(array['admin', 'accountant', 'receptionist']::public.app_role[])));
