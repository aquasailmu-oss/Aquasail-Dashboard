-- WP-05: clients, the fleet, bookings and everything hanging off them,
-- payments, tickets, the reference counter and app settings.
--
-- Money rows are written by database functions, not by direct table writes:
-- create_booking() (WP-06) inserts bookings, lines, participants,
-- entitlements and tickets atomically, with amounts computed on the server.
-- Direct grants below are limited to what staff legitimately edit by hand.

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- clients
-- ---------------------------------------------------------------------------

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  phone_e164 text check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  email text,
  country text,
  notes text,
  search_text text generated always as (
    lower(first_name || ' ' || last_name || ' ' || coalesce(phone_e164, '') || ' ' || coalesce(email, ''))
  ) stored,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index clients_search_trgm_idx on public.clients using gin (search_text extensions.gin_trgm_ops);
create unique index clients_phone_unique_idx on public.clients (phone_e164) where phone_e164 is not null;
create index clients_email_idx on public.clients (lower(email));

create trigger clients_set_updated_at before update on public.clients
  for each row execute function public.set_updated_at();
create trigger clients_audit after insert or update or delete on public.clients
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- resources: AquaSail's boats (V4 concept pulled into V1, see CLAUDE.md).
-- Capacity is shown and warned about, not enforced, in V1.
-- ---------------------------------------------------------------------------

create table public.resources (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  resource_type text not null,
  capacity int not null check (capacity > 0),
  sort_order int not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger resources_set_updated_at before update on public.resources
  for each row execute function public.set_updated_at();
create trigger resources_audit after insert or update or delete on public.resources
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- bookings
-- ---------------------------------------------------------------------------

create type public.booking_status as enum ('confirmed', 'cancelled', 'no_show', 'completed');
create type public.payment_method as enum ('cash', 'card', 'bank_transfer', 'operator_account', 'other');

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  client_id uuid not null references public.clients (id) on delete restrict,
  source_type text not null check (source_type in ('walk_in', 'operator')),
  operator_id uuid references public.tour_operators (id),
  resource_id uuid references public.resources (id),
  service_date date not null,
  departure_time time,
  meeting_point text,
  status public.booking_status not null default 'confirmed',
  -- Financial snapshot, integer cents, written by create_booking().
  retail_total_cents bigint not null default 0,
  charged_total_cents bigint not null default 0,
  discount_total_cents bigint not null default 0,
  operator_net_total_cents bigint not null default 0,
  commission_total_cents bigint not null default 0,
  payer text not null default 'client' check (payer in ('client', 'operator')),
  notes text,
  idempotency_key text unique,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  cancellation_reason text,

  constraint bookings_operator_iff_operator_source check ((source_type = 'operator') = (operator_id is not null)),
  constraint bookings_walk_in_pays check (source_type = 'operator' or payer = 'client'),
  constraint bookings_cancelled_has_details check (
    status <> 'cancelled' or (cancelled_at is not null and nullif(trim(cancellation_reason), '') is not null)
  )
);

create index bookings_service_date_idx on public.bookings (service_date);
create index bookings_client_idx on public.bookings (client_id);
create index bookings_operator_idx on public.bookings (operator_id);
create index bookings_status_idx on public.bookings (status);
create index bookings_resource_date_idx on public.bookings (resource_id, service_date) where resource_id is not null;

-- Cancelling stamps who and when on the server; staff only supply the reason.
create function public.stamp_booking_cancellation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    if nullif(trim(new.cancellation_reason), '') is null then
      raise exception 'Give a reason for cancelling this booking.';
    end if;
    new.cancelled_at := now();
    new.cancelled_by := auth.uid();
  end if;
  return new;
end;
$$;

create trigger bookings_stamp_cancellation before update on public.bookings
  for each row execute function public.stamp_booking_cancellation();
create trigger bookings_set_updated_at before update on public.bookings
  for each row execute function public.set_updated_at();
create trigger bookings_audit after insert or update or delete on public.bookings
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- booking_items: one priced line, with its price snapshot. All amounts are
-- per unit except discount_cents and commission_cents, which are line totals.
-- ---------------------------------------------------------------------------

create table public.booking_items (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  line_type text not null check (line_type in ('package', 'activity')),
  package_id uuid references public.packages (id),
  activity_id uuid references public.activities (id),
  participant_type public.participant_type not null,
  quantity int not null check (quantity > 0),
  unit_retail_cents bigint not null check (unit_retail_cents >= 0),
  unit_charged_cents bigint not null check (unit_charged_cents >= 0),
  unit_operator_net_cents bigint check (unit_operator_net_cents >= 0),
  commission_rate numeric(5, 4) check (commission_rate >= 0 and commission_rate <= 1),
  commission_cents bigint not null default 0 check (commission_cents >= 0),
  discount_cents bigint not null default 0 check (discount_cents >= 0),
  discount_reason text,
  price_rule_id uuid references public.price_rules (id), -- null for components packages (several rules)
  sort_order int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint booking_items_one_target check (
    (line_type = 'package' and package_id is not null and activity_id is null)
    or (line_type = 'activity' and activity_id is not null and package_id is null)
  ),
  constraint booking_items_discount_reason check (
    discount_cents = 0 or nullif(trim(discount_reason), '') is not null
  )
);

create index booking_items_booking_idx on public.booking_items (booking_id);

create trigger booking_items_set_updated_at before update on public.booking_items
  for each row execute function public.set_updated_at();
create trigger booking_items_audit after insert or update or delete on public.booking_items
  for each row execute function public.audit_trigger();

create table public.booking_participants (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  participant_type public.participant_type not null,
  count int not null check (count > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (booking_id, participant_type)
);

create trigger booking_participants_set_updated_at before update on public.booking_participants
  for each row execute function public.set_updated_at();
create trigger booking_participants_audit after insert or update or delete on public.booking_participants
  for each row execute function public.audit_trigger();

-- The entitlements a booking confers, expanded at creation; V2 redeems them.
create table public.booking_activities (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  activity_id uuid not null references public.activities (id),
  quantity int not null check (quantity > 0),
  source_item_id uuid references public.booking_items (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (booking_id, activity_id, source_item_id)
);

create index booking_activities_booking_idx on public.booking_activities (booking_id);
create index booking_activities_activity_idx on public.booking_activities (activity_id);

create trigger booking_activities_audit after insert or update or delete on public.booking_activities
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- payments: append-only. A mistake is reversed with a negative correction row
-- that references the original; both stay visible forever.
-- ---------------------------------------------------------------------------

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete restrict,
  amount_cents bigint not null check (amount_cents <> 0),
  method public.payment_method not null,
  received_from text not null check (received_from in ('client', 'operator')),
  received_at timestamptz not null default now(),
  reference text,
  note text,
  is_correction boolean not null default false,
  corrects_payment_id uuid references public.payments (id),
  recorded_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),

  constraint payments_negative_is_correction check (
    amount_cents > 0 or (is_correction and nullif(trim(note), '') is not null)
  ),
  constraint payments_correction_references_original check (
    not is_correction or corrects_payment_id is not null
  )
);

create index payments_booking_idx on public.payments (booking_id);
create index payments_received_at_idx on public.payments (received_at);

create function public.check_payment_correction()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_original public.payments;
begin
  if new.corrects_payment_id is null then
    return new;
  end if;
  select * into v_original from public.payments where id = new.corrects_payment_id;
  if v_original.booking_id is distinct from new.booking_id then
    raise exception 'A correction must be recorded on the same booking as the payment it corrects.';
  end if;
  if v_original.is_correction then
    raise exception 'Correct the original payment, not a previous correction.';
  end if;
  return new;
end;
$$;

create trigger payments_check_correction before insert on public.payments
  for each row execute function public.check_payment_correction();
create trigger payments_audit after insert or update or delete on public.payments
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- tickets: one per booking. The token is the future QR payload (V2), so it
-- is random and unguessable, never derived from the reference.
-- ---------------------------------------------------------------------------

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings (id) on delete cascade,
  token text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  issued_at timestamptz not null default now(),
  printed_count int not null default 0 check (printed_count >= 0)
);

create trigger tickets_audit after insert or update or delete on public.tickets
  for each row execute function public.audit_trigger();

-- Backs next_booking_reference() (WP-06). Touched only by that function.
create table public.booking_sequences (
  service_date date primary key,
  last_number int not null default 0
);

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references public.profiles (id) default auth.uid(),
  updated_at timestamptz not null default now()
);

create trigger app_settings_set_updated_at before update on public.app_settings
  for each row execute function public.set_updated_at();
create trigger app_settings_audit after insert or update or delete on public.app_settings
  for each row execute function public.audit_trigger('key');

-- ---------------------------------------------------------------------------
-- Grants. Nothing is deleted by anyone. anon gets nothing.
-- ---------------------------------------------------------------------------

revoke all on table
  public.clients, public.resources, public.bookings, public.booking_items, public.booking_participants,
  public.booking_activities, public.payments, public.tickets, public.booking_sequences, public.app_settings
  from anon, authenticated;

grant select, insert, update on table public.clients, public.resources, public.app_settings to authenticated;
grant select on table
  public.bookings, public.booking_items, public.booking_participants, public.booking_activities,
  public.payments, public.tickets
  to authenticated;
-- Hand-editable booking fields. Lines, totals and amendments go through
-- functions; cancelled_at/by are stamped by trigger.
grant update (departure_time, meeting_point, notes, resource_id, status, cancellation_reason)
  on table public.bookings to authenticated;
-- received_at and recorded_by take their defaults: staff cannot backdate
-- cash into another day or record it in someone else's name.
grant insert (booking_id, amount_cents, method, received_from, reference, note, is_correction, corrects_payment_id)
  on table public.payments to authenticated;
grant update (printed_count) on table public.tickets to authenticated;

-- ---------------------------------------------------------------------------
-- RLS (build plan §8). activity_staff see none of this; their V2 access is a
-- narrow scan endpoint.
-- ---------------------------------------------------------------------------

alter table public.clients enable row level security;
alter table public.resources enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_items enable row level security;
alter table public.booking_participants enable row level security;
alter table public.booking_activities enable row level security;
alter table public.payments enable row level security;
alter table public.tickets enable row level security;
alter table public.booking_sequences enable row level security;
alter table public.app_settings enable row level security;

-- clients
create policy "office staff read clients" on public.clients for select to authenticated
  using ((select public.has_role(array['admin', 'accountant', 'receptionist']::public.app_role[])));
create policy "admins and reception create clients" on public.clients for insert to authenticated
  with check ((select public.has_role(array['admin', 'receptionist']::public.app_role[])));
create policy "admins and reception update clients" on public.clients for update to authenticated
  using ((select public.has_role(array['admin', 'receptionist']::public.app_role[])))
  with check ((select public.has_role(array['admin', 'receptionist']::public.app_role[])));

-- resources
create policy "active staff read the fleet" on public.resources for select to authenticated
  using ((select public.auth_role()) is not null);
create policy "admins add boats" on public.resources for insert to authenticated
  with check ((select public.is_admin()));
create policy "admins update boats" on public.resources for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- bookings and their children
create policy "office staff read bookings" on public.bookings for select to authenticated
  using ((select public.has_role(array['admin', 'accountant', 'receptionist']::public.app_role[])));
create policy "admins update any booking" on public.bookings for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
-- Reception may amend or cancel today's and future bookings, never past ones:
-- otherwise a reconciled day's totals could silently change.
create policy "reception updates current bookings" on public.bookings for update to authenticated
  using (
    (select public.has_role(array['receptionist']::public.app_role[]))
    and service_date >= (select public.today_mauritius())
    and status <> 'cancelled'
  )
  with check (
    (select public.has_role(array['receptionist']::public.app_role[]))
    and service_date >= (select public.today_mauritius())
  );

create policy "office staff read booking items" on public.booking_items for select to authenticated
  using ((select public.has_role(array['admin', 'accountant', 'receptionist']::public.app_role[])));
create policy "office staff read booking participants" on public.booking_participants for select to authenticated
  using ((select public.has_role(array['admin', 'accountant', 'receptionist']::public.app_role[])));
create policy "office staff read booking activities" on public.booking_activities for select to authenticated
  using ((select public.has_role(array['admin', 'accountant', 'receptionist']::public.app_role[])));

-- payments: no update or delete policy for anyone, ever.
create policy "office staff read payments" on public.payments for select to authenticated
  using ((select public.has_role(array['admin', 'accountant', 'receptionist']::public.app_role[])));
create policy "admins and reception record payments" on public.payments for insert to authenticated
  with check ((select public.has_role(array['admin', 'receptionist']::public.app_role[])));

-- tickets
create policy "admins and reception read tickets" on public.tickets for select to authenticated
  using ((select public.has_role(array['admin', 'receptionist']::public.app_role[])));
create policy "admins and reception count prints" on public.tickets for update to authenticated
  using ((select public.has_role(array['admin', 'receptionist']::public.app_role[])))
  with check ((select public.has_role(array['admin', 'receptionist']::public.app_role[])));

-- booking_sequences: RLS on, no policies, no grants.

-- app_settings
create policy "active staff read settings" on public.app_settings for select to authenticated
  using ((select public.auth_role()) is not null);
create policy "admins add settings" on public.app_settings for insert to authenticated
  with check ((select public.is_admin()));
create policy "admins change settings" on public.app_settings for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
