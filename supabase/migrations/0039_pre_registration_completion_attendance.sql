-- Preserve expected age-group counts at pre-registration and complete
-- attendance atomically with booking creation.
alter table public.booking_pre_registrations
  add column adults_expected_count integer,
  add column children_expected_count integer,
  add column infants_expected_count integer,
  add constraint booking_pre_registrations_expected_pax check (
    (adults_expected_count is null and children_expected_count is null and infants_expected_count is null)
    or (
      adults_expected_count between 0 and 500
      and children_expected_count between 0 and 500
      and infants_expected_count between 0 and 500
      and adults_expected_count + children_expected_count + infants_expected_count > 0
    )
  );

drop function public.create_booking_pre_registration(text, text, uuid, date, uuid, text, text, text, text, text);

create function public.create_booking_pre_registration(
  p_first_name text,
  p_last_name text,
  p_operator_id uuid,
  p_service_date date,
  p_client_id uuid default null,
  p_phone_e164 text default null,
  p_email text default null,
  p_country text default null,
  p_notes text default null,
  p_hotel_name text default null,
  p_adults_expected_count integer default 1,
  p_children_expected_count integer default 0,
  p_infants_expected_count integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_id uuid := p_client_id;
  v_hotel_name text := nullif(trim(p_hotel_name), '');
  v_registration public.booking_pre_registrations;
begin
  if not public.has_role(array['admin', 'receptionist']::public.app_role[]) then
    raise exception 'Only reception or an admin can pre-register a client.';
  end if;
  if p_first_name is null or length(trim(p_first_name)) not between 1 and 80
     or coalesce(length(trim(p_last_name)), 0) > 80
     or coalesce(length(trim(p_email)), 0) > 200
     or coalesce(length(trim(p_country)), 0) > 60
     or coalesce(length(trim(p_notes)), 0) > 1000
     or char_length(v_hotel_name) > 120 then
    raise exception 'Check the client details and try again.';
  end if;
  if p_adults_expected_count is null or p_children_expected_count is null or p_infants_expected_count is null
     or p_adults_expected_count not between 0 and 500
     or p_children_expected_count not between 0 and 500
     or p_infants_expected_count not between 0 and 500
     or p_adults_expected_count + p_children_expected_count + p_infants_expected_count = 0 then
    raise exception 'Enter at least one expected guest.';
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

  insert into public.booking_pre_registrations (
    client_id, operator_id, service_date, notes, hotel_name,
    adults_expected_count, children_expected_count, infants_expected_count
  ) values (
    v_client_id, p_operator_id, p_service_date, nullif(trim(p_notes), ''), v_hotel_name,
    p_adults_expected_count, p_children_expected_count, p_infants_expected_count
  ) returning * into v_registration;

  return jsonb_build_object('id', v_registration.id, 'idempotency_key', v_registration.idempotency_key);
end;
$$;

revoke all on function public.create_booking_pre_registration(text, text, uuid, date, uuid, text, text, text, text, text, integer, integer, integer)
  from public, anon;
grant execute on function public.create_booking_pre_registration(text, text, uuid, date, uuid, text, text, text, text, text, integer, integer, integer)
  to authenticated;

create or replace function public.create_booking_with_hotel(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_booking_id uuid;
  v_hotel_name text := nullif(trim(payload ->> 'hotel_name'), '');
  v_attendance jsonb := payload -> 'attendance';
begin
  if not public.has_role(array['admin', 'receptionist']::public.app_role[]) then
    raise exception 'Only reception or an admin can create bookings.';
  end if;
  if char_length(v_hotel_name) > 120 then
    raise exception 'Keep the hotel name under 120 characters.';
  end if;

  v_result := public.create_booking(payload - 'hotel_name' - 'attendance');
  v_booking_id := (v_result ->> 'booking_id')::uuid;

  update public.bookings
  set hotel_name = v_hotel_name
  where id = v_booking_id
    and hotel_name is distinct from v_hotel_name;

  if v_attendance is not null then
    if jsonb_typeof(v_attendance) <> 'object'
       or not (v_attendance ?& array[
         'adults_present', 'children_present', 'infants_present', 'prebook_reduction_cents'
       ]) then
      raise exception 'Attendance details are incomplete.';
    end if;
    perform public.record_booking_attendance(
      v_booking_id,
      (v_attendance ->> 'adults_present')::integer,
      (v_attendance ->> 'children_present')::integer,
      (v_attendance ->> 'infants_present')::integer,
      (v_attendance ->> 'prebook_reduction_cents')::bigint,
      nullif(v_attendance ->> 'prebook_reduction_reason', '')
    );
  end if;

  return v_result;
end;
$$;
