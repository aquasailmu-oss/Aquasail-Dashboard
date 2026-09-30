-- WP-29 (V2): the day manifest and sync endpoint. The manifest is what
-- the island device caches in IndexedDB: one row per confirmed booking
-- with service_date = today, carrying HASHES of tokens (never the tokens
-- themselves) so a lost device leaks surnames and lunch counts but not
-- working ticket URLs.

-- ---------------------------------------------------------------------------
-- day_manifest(): returns today's confirmed bookings in the narrow shape
-- the offline cache needs. Security definer because island staff have no
-- table grants.
-- ---------------------------------------------------------------------------

create function public.day_manifest(p_device_id uuid, p_device_secret text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.staff_devices;
  v_rows jsonb;
begin
  if public.auth_role() is null
     or public.auth_role() not in ('admin', 'receptionist', 'activity_supervisor', 'activity_staff') then
    raise exception 'Your role cannot use the island app.';
  end if;

  v_device := public.verified_device(p_device_id, p_device_secret);

  select coalesce(jsonb_agg(row_data order by b.departure_time nulls last, b.reference), '[]'::jsonb)
  into v_rows
  from public.bookings b
  join public.clients c on c.id = b.client_id
  cross join lateral (
    select jsonb_build_object(
      'booking_id',       b.id,
      'token_hash',       (select t.token_hash from public.tickets t
                           where t.booking_id = b.id and t.revoked_at is null
                           limit 1),
      'reference',        b.reference,
      'surname',          c.last_name,
      'client_first_initial', left(c.first_name, 1),
      'adults',           coalesce((select bp.count from public.booking_participants bp
                                  where bp.booking_id = b.id and bp.participant_type = 'adult'), 0),
      'children',         coalesce((select bp.count from public.booking_participants bp
                                    where bp.booking_id = b.id and bp.participant_type = 'child'), 0),
      'infants',          coalesce((select bp.count from public.booking_participants bp
                                    where bp.booking_id = b.id and bp.participant_type = 'infant'), 0),
      'service_date',     b.service_date,
      'departure_time',   b.departure_time,
      'meeting_point',    b.meeting_point,
      'checked_in_at',    b.checked_in_at,
      'entitlements',     (
        select coalesce(jsonb_agg(jsonb_build_object(
          'booking_activity_id', ba.id,
          'activity_code',       a.code,
          'activity_name',       a.name,
          'quantity',            ba.quantity,
          'already_redeemed',    coalesce((
            select sum(tr.quantity_redeemed)
            from public.ticket_redemptions tr
            where tr.booking_activity_id = ba.id
          ), 0)
        ) order by a.sort_order, a.name), '[]'::jsonb)
        from public.booking_activities ba
        join public.activities a on a.id = ba.activity_id
        where ba.booking_id = b.id and a.is_redeemable
      )
    ) as row_data
  ) sub
  where b.service_date = (now() at time zone 'Indian/Mauritius')::date
    and b.status = 'confirmed';

  -- Touch last_seen_at so the supervisor knows this device is alive.
  update public.staff_devices
  set last_seen_at = now()
  where id = v_device.id;

  return jsonb_build_object(
    'generated_at', now(),
    'business_date', (now() at time zone 'Indian/Mauritius')::date,
    'bookings', v_rows
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- sync_queued_item(): processes one queued redemption or check-in from an
-- offline device. Returns the outcome per item so the device knows what
-- to clear and what to escalate.
--
-- p_type: 'redeem' or 'check_in'
-- p_payload: the item-specific fields (booking_activity_id+quantity for
--   redeem, booking_id for check_in)
-- Returns: { result: 'applied'|'already_applied'|'over_redemption'|'rejected',
--            reason?: string, ...function-specific fields }
-- ---------------------------------------------------------------------------

create function public.sync_queued_item(
  p_device_id   uuid,
  p_device_secret text,
  p_type        text,
  p_payload     jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.staff_devices;
  v_result jsonb;
  v_client_uuid uuid;
begin
  if public.auth_role() is null
     or public.auth_role() not in ('admin', 'receptionist', 'activity_supervisor', 'activity_staff') then
    raise exception 'Your role cannot use the island app.';
  end if;

  v_device := public.verified_device(p_device_id, p_device_secret);
  v_client_uuid := (p_payload->>'client_uuid')::uuid;

  if v_client_uuid is null then
    return jsonb_build_object('result', 'rejected', 'reason', 'Missing client_uuid.');
  end if;

  if p_type = 'redeem' then
    begin
      v_result := public.redeem_activity(
        p_booking_activity_id := (p_payload->>'booking_activity_id')::uuid,
        p_quantity            := (p_payload->>'quantity')::int,
        p_client_uuid         := v_client_uuid,
        p_location_id         := v_device.location_id,
        p_device_id           := p_device_id,
        p_device_secret       := p_device_secret,
        p_occurred_at_device  := (p_payload->>'occurred_at_device')::timestamptz,
        p_note                := p_payload->>'note',
        p_from_queue          := true
      );
    exception when others then
      return jsonb_build_object('result', 'rejected', 'reason', sqlerrm);
    end;

    if (v_result->>'already_applied')::boolean then
      return v_result || jsonb_build_object('result', 'already_applied');
    elsif (v_result->>'is_over_redemption')::boolean then
      return v_result || jsonb_build_object('result', 'over_redemption');
    else
      return v_result || jsonb_build_object('result', 'applied');
    end if;

  elsif p_type = 'check_in' then
    begin
      v_result := public.check_in_booking(
        p_booking_id          := (p_payload->>'booking_id')::uuid,
        p_client_uuid         := v_client_uuid,
        p_location_id         := v_device.location_id,
        p_device_id           := p_device_id,
        p_device_secret       := p_device_secret,
        p_occurred_at_device  := (p_payload->>'occurred_at_device')::timestamptz,
        p_from_queue          := true
      );
    exception when others then
      return jsonb_build_object('result', 'rejected', 'reason', sqlerrm);
    end;

    if (v_result->>'already_checked_in')::boolean then
      return v_result || jsonb_build_object('result', 'already_applied');
    else
      return v_result || jsonb_build_object('result', 'applied');
    end if;

  else
    return jsonb_build_object('result', 'rejected', 'reason', 'Unknown item type: ' || coalesce(p_type, 'null'));
  end if;
end;
$$;

-- Grants: same narrow set as the other island functions.
revoke execute on function public.day_manifest(uuid, text) from public, anon;
grant execute on function public.day_manifest(uuid, text) to authenticated;

revoke execute on function public.sync_queued_item(uuid, text, text, jsonb) from public, anon;
grant execute on function public.sync_queued_item(uuid, text, text, jsonb) to authenticated;
