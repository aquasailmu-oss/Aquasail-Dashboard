-- WP-27 (V2): what the island app needs from the database. Device
-- registration, the device's own details for the status bar, and manual
-- reference entry, which answers exactly as a scan does.

-- ---------------------------------------------------------------------------
-- register_device(): a supervisor or admin registers a tablet. The secret is
-- generated here, only its hash is stored, and it is returned this once: the
-- app keeps it in an httpOnly cookie on the device.
-- ---------------------------------------------------------------------------

create function public.register_device(p_label text, p_location_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text := encode(extensions.gen_random_bytes(32), 'hex');
  v_device public.staff_devices;
begin
  if public.auth_role() is null or public.auth_role() not in ('admin', 'activity_supervisor') then
    raise exception 'Only a supervisor or an admin can register a device.';
  end if;
  if nullif(trim(p_label), '') is null then
    raise exception 'Give the device a name people will recognise, like "Island tablet 3".';
  end if;
  if exists (select 1 from public.staff_devices where is_active and lower(label) = lower(trim(p_label))) then
    raise exception 'A device called "%" is already registered. Choose another name.', trim(p_label);
  end if;
  if not exists (select 1 from public.locations where id = p_location_id and is_active) then
    raise exception 'Choose where this device is used.';
  end if;

  insert into public.staff_devices (label, location_id, device_secret_hash, registered_by)
  values (trim(p_label), p_location_id, encode(extensions.digest(v_secret, 'sha256'), 'hex'), auth.uid())
  returning * into v_device;

  return jsonb_build_object('device_id', v_device.id, 'secret', v_secret, 'label', v_device.label);
end;
$$;

-- ---------------------------------------------------------------------------
-- device_info(): the calling device's name and place, for the status bar.
-- Raises the same sentences as every other device check, so a deactivated
-- tablet finds out on its next screen.
-- ---------------------------------------------------------------------------

create function public.device_info(p_device_id uuid, p_device_secret text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.staff_devices;
begin
  if public.auth_role() is null
     or public.auth_role() not in ('admin', 'receptionist', 'activity_supervisor', 'activity_staff') then
    raise exception 'Your role cannot use the island app.';
  end if;
  v_device := public.verified_device(p_device_id, p_device_secret);
  if v_device.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'device_id', v_device.id,
    'label', v_device.label,
    'location_id', v_device.location_id,
    'location_name', (select name from public.locations where id = v_device.location_id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- The scan payload, shared by a scanned token and a typed reference so the
-- two can never answer differently. Internal; see 0021 for what it must
-- never carry.
-- ---------------------------------------------------------------------------

create function public.scan_payload(p_ticket_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_booking_id uuid;
  v_revoked boolean;
  v_status public.booking_status;
  v_service_date date;
  v_entitlements jsonb;
  v_verdict text;
begin
  select t.booking_id, t.revoked_at is not null, b.status, b.service_date
  into v_booking_id, v_revoked, v_status, v_service_date
  from public.tickets t
  join public.bookings b on b.id = t.booking_id
  where t.id = p_ticket_id;

  if v_booking_id is null then
    return jsonb_build_object('verdict', 'NOT_FOUND');
  end if;

  v_entitlements := public.booking_entitlements(v_booking_id);

  -- The first that applies wins. CANCELLED before REVOKED: see 0022.
  v_verdict := case
    when v_status = 'cancelled' then 'CANCELLED'
    when v_revoked then 'REVOKED'
    when v_service_date <> public.today_mauritius() then 'WRONG_DATE'
    when jsonb_array_length(v_entitlements) > 0
      and not exists (select 1 from jsonb_array_elements(v_entitlements) e where (e ->> 'remaining')::int > 0)
      then 'ALREADY_REDEEMED'
    when exists (select 1 from jsonb_array_elements(v_entitlements) e where (e ->> 'redeemed')::int > 0)
      then 'PARTLY_USED'
    else 'VALID'
  end;

  return (
    select jsonb_build_object(
      'verdict', v_verdict,
      'booking_id', b.id,
      'reference', b.reference,
      'client_surname', c.last_name,
      'client_first_initial', left(c.first_name, 1),
      'adults', coalesce((select bp.count from public.booking_participants bp
                          where bp.booking_id = b.id and bp.participant_type = 'adult'), 0),
      'children', coalesce((select bp.count from public.booking_participants bp
                            where bp.booking_id = b.id and bp.participant_type = 'child'), 0),
      'infants', coalesce((select bp.count from public.booking_participants bp
                           where bp.booking_id = b.id and bp.participant_type = 'infant'), 0),
      'service_date', b.service_date,
      'departure_time', b.departure_time,
      'meeting_point', b.meeting_point,
      'checked_in_at', b.checked_in_at,
      'checked_in_by_name', (select p.full_name from public.profiles p where p.id = b.checked_in_by),
      'entitlements', v_entitlements,
      -- Active activities this booking does not include, so "is parasailing
      -- included?" gets an answer rather than a silence.
      'not_included', (
        select coalesce(jsonb_agg(jsonb_build_object('activity_code', a.code, 'activity_name', a.name)
                                  order by a.sort_order, a.name), '[]'::jsonb)
        from public.activities a
        where a.is_active and a.is_redeemable
          and not exists (select 1 from public.booking_activities ba where ba.booking_id = b.id and ba.activity_id = a.id)
      )
    )
    from public.bookings b
    join public.clients c on c.id = b.client_id
    where b.id = v_booking_id
  );
end;
$$;

create or replace function public.scan_ticket(
  p_token text,
  p_device_id uuid default null,
  p_device_secret text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.auth_role() is null
     or public.auth_role() not in ('admin', 'receptionist', 'activity_supervisor', 'activity_staff') then
    raise exception 'Your role cannot scan tickets.';
  end if;
  perform public.verified_device(p_device_id, p_device_secret);
  return public.scan_payload((select id from public.tickets where token = trim(p_token)));
end;
$$;

-- ---------------------------------------------------------------------------
-- scan_reference(): manual entry, for when a camera fails in salt spray or
-- glare. Accepts the digits alone ("0042", or "42") for today's booking, or
-- the full reference. Answers from the booking's live ticket, or its latest
-- if none is live (so a cancelled booking still says CANCELLED).
-- ---------------------------------------------------------------------------

create function public.scan_reference(
  p_reference text,
  p_device_id uuid default null,
  p_device_secret text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_input text := upper(regexp_replace(coalesce(p_reference, ''), '\s', '', 'g'));
  v_reference text;
begin
  if public.auth_role() is null
     or public.auth_role() not in ('admin', 'receptionist', 'activity_supervisor', 'activity_staff') then
    raise exception 'Your role cannot scan tickets.';
  end if;
  perform public.verified_device(p_device_id, p_device_secret);

  v_reference := case
    when v_input ~ '^[0-9]{1,4}$' then 'WS-' || to_char(public.today_mauritius(), 'YYYYMMDD') || '-' || lpad(v_input, 4, '0')
    when v_input ~ '^WS-?[0-9]{8}-?[0-9]{1,4}$'
      then 'WS-' || substr(regexp_replace(v_input, '[^0-9]', '', 'g'), 1, 8) || '-'
           || lpad(substr(regexp_replace(v_input, '[^0-9]', '', 'g'), 9), 4, '0')
    else v_input
  end;

  return public.scan_payload((
    select t.id
    from public.tickets t
    join public.bookings b on b.id = t.booking_id
    where b.reference = v_reference
    order by (t.revoked_at is null) desc, t.issued_at desc
    limit 1
  ));
end;
$$;

revoke execute on function public.scan_payload(uuid) from public, anon, authenticated;
revoke execute on function public.register_device(text, uuid) from public, anon;
revoke execute on function public.device_info(uuid, text) from public, anon;
revoke execute on function public.scan_reference(text, uuid, text) from public, anon;
grant execute on function public.register_device(text, uuid) to authenticated;
grant execute on function public.device_info(uuid, text) to authenticated;
grant execute on function public.scan_reference(text, uuid, text) to authenticated;
