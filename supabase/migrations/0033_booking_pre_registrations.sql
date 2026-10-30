-- Staff can save the client's details and visit date ahead of time. On the
-- visit date, staff completes the normal booking from this searchable record.
create table public.booking_pre_registrations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete restrict,
  operator_id uuid not null references public.tour_operators (id) on delete restrict,
  service_date date not null,
  notes text,
  status text not null default 'open' check (status in ('open', 'completed', 'cancelled')),
  idempotency_key uuid not null default gen_random_uuid() unique,
  booking_id uuid unique references public.bookings (id) on delete restrict,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_pre_registrations_completion check (
    (status = 'completed' and booking_id is not null)
    or (status <> 'completed' and booking_id is null)
  )
);

create index booking_pre_registrations_search_idx on public.booking_pre_registrations (service_date, status);
create trigger booking_pre_registrations_set_updated_at before update on public.booking_pre_registrations
  for each row execute function public.set_updated_at();
create trigger booking_pre_registrations_audit after insert or update on public.booking_pre_registrations
  for each row execute function public.audit_trigger();

alter table public.booking_pre_registrations enable row level security;
revoke all on public.booking_pre_registrations from anon, authenticated;
create policy "office staff read pre-registrations" on public.booking_pre_registrations for select to authenticated
  using ((select public.has_role(array['admin', 'receptionist']::public.app_role[])));
grant select on public.booking_pre_registrations to authenticated;

drop function if exists public.create_booking_pre_registration(uuid, text, text, text, text, text, uuid, date, text);

create function public.create_booking_pre_registration(
  p_first_name text,
  p_last_name text,
  p_operator_id uuid,
  p_service_date date,
  p_client_id uuid default null,
  p_phone_e164 text default null,
  p_email text default null,
  p_country text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_id uuid := p_client_id;
  v_registration public.booking_pre_registrations;
begin
  if not public.has_role(array['admin', 'receptionist']::public.app_role[]) then
    raise exception 'Only reception or an admin can pre-register a client.';
  end if;
  if p_first_name is null or length(trim(p_first_name)) not between 1 and 80
     or coalesce(length(trim(p_last_name)), 0) > 80
     or coalesce(length(trim(p_email)), 0) > 200
     or coalesce(length(trim(p_country)), 0) > 60
     or coalesce(length(trim(p_notes)), 0) > 1000 then
    raise exception 'Check the client details and try again.';
  end if;
  if p_phone_e164 is not null and p_phone_e164 !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'Enter a valid phone number.';
  end if;
  if p_email is not null and p_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid email address, or leave it empty.';
  end if;
  if p_service_date is null or p_service_date < public.today_mauritius() then
    raise exception 'Choose today or a future visit date.';
  end if;
  if not exists (select 1 from public.tour_operators where id = p_operator_id and is_active) then
    raise exception 'Choose an active tour operator.';
  end if;

  if v_client_id is not null then
    if not exists (select 1 from public.clients where id = v_client_id) then
      raise exception 'That client could not be found.';
    end if;
  else
    begin
      insert into public.clients (first_name, last_name, phone_e164, email, country, created_by)
      values (
        trim(p_first_name), coalesce(trim(p_last_name), ''), p_phone_e164,
        nullif(lower(trim(p_email)), ''), nullif(trim(p_country), ''), auth.uid()
      ) returning id into v_client_id;
    exception when unique_violation then
      raise exception 'A client with that phone number already exists. Search for and select the existing client.';
    end;
  end if;

  insert into public.booking_pre_registrations (client_id, operator_id, service_date, notes)
  values (v_client_id, p_operator_id, p_service_date, nullif(trim(p_notes), ''))
  returning * into v_registration;

  return jsonb_build_object(
    'id', v_registration.id,
    'idempotency_key', v_registration.idempotency_key
  );
end;
$$;

create or replace function public.complete_booking_pre_registration(p_registration_id uuid, p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_registration public.booking_pre_registrations;
  v_booking public.bookings;
begin
  if not public.has_role(array['admin', 'receptionist']::public.app_role[]) then
    raise exception 'Only reception or an admin can complete a pre-registration.';
  end if;
  select * into v_registration from public.booking_pre_registrations where id = p_registration_id for update;
  if not found then raise exception 'That pre-registration could not be found.'; end if;
  select * into v_booking from public.bookings where id = p_booking_id;
  if not found or v_booking.client_id <> v_registration.client_id
     or v_booking.operator_id <> v_registration.operator_id
     or v_booking.service_date <> v_registration.service_date
     or v_booking.idempotency_key is distinct from v_registration.idempotency_key::text then
    raise exception 'The booking does not match this pre-registration.';
  end if;
  if v_registration.status = 'completed' then
    if v_registration.booking_id = p_booking_id then return; end if;
    raise exception 'This pre-registration has already been completed.';
  end if;
  if v_registration.status <> 'open' then raise exception 'This pre-registration is no longer open.'; end if;
  update public.booking_pre_registrations set status = 'completed', booking_id = p_booking_id
  where id = p_registration_id;
end;
$$;

revoke all on function public.create_booking_pre_registration(text, text, uuid, date, uuid, text, text, text, text) from public, anon;
revoke all on function public.complete_booking_pre_registration(uuid, uuid) from public, anon;
grant execute on function public.create_booking_pre_registration(text, text, uuid, date, uuid, text, text, text, text) to authenticated;
grant execute on function public.complete_booking_pre_registration(uuid, uuid) to authenticated;
