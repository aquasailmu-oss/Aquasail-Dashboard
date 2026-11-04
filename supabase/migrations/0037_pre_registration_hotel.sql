-- Keep the client's referring hotel with the pre-registration and carry it
-- into the eventual booking.
alter table public.booking_pre_registrations
  add column hotel_name text,
  add constraint booking_pre_registrations_hotel_name_length
    check (hotel_name is null or char_length(hotel_name) <= 120);

-- Replace the prior RPC with a backward-compatible optional hotel argument.
drop function public.create_booking_pre_registration(text, text, uuid, date, uuid, text, text, text, text);

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
  p_hotel_name text default null
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

  insert into public.booking_pre_registrations (client_id, operator_id, service_date, notes, hotel_name)
  values (v_client_id, p_operator_id, p_service_date, nullif(trim(p_notes), ''), v_hotel_name)
  returning * into v_registration;

  return jsonb_build_object(
    'id', v_registration.id,
    'idempotency_key', v_registration.idempotency_key
  );
end;
$$;

revoke all on function public.create_booking_pre_registration(text, text, uuid, date, uuid, text, text, text, text, text)
  from public, anon;
grant execute on function public.create_booking_pre_registration(text, text, uuid, date, uuid, text, text, text, text, text)
  to authenticated;
