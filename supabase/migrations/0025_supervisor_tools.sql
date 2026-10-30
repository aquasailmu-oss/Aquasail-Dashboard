-- WP-30 (V2): supervisor tools. The review queue, device listing, and shift
-- handover summary are all security definer functions returning narrow
-- payloads — island roles still have no table grants.

-- ---------------------------------------------------------------------------
-- review_queue(): items needing a supervisor's attention. Each row is an
-- over-redemption or a provisional redemption that has not been reviewed.
-- ---------------------------------------------------------------------------

create function public.review_queue(p_device_id uuid, p_device_secret text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_device public.staff_devices;
  v_items jsonb;
begin
  if public.auth_role() is null
     or public.auth_role() not in ('admin', 'activity_supervisor') then
    raise exception 'Only a supervisor or an admin can see the review queue.';
  end if;

  v_device := public.verified_device(p_device_id, p_device_secret);

  select coalesce(jsonb_agg(item order by tr.redeemed_at), '[]'::jsonb)
  into v_items
  from public.ticket_redemptions tr
  join public.booking_activities ba on ba.id = tr.booking_activity_id
  join public.activities a on a.id = ba.activity_id
  join public.bookings b on b.id = tr.booking_id
  join public.clients c on c.id = b.client_id
  cross join lateral (
    select jsonb_build_object(
      'redemption_id',      tr.id,
      'booking_id',         b.id,
      'reference',          b.reference,
      'client_surname',     c.last_name,
      'activity_name',      a.name,
      'quantity_redeemed',  tr.quantity_redeemed,
      'is_over_redemption', tr.is_over_redemption,
      'is_provisional',     tr.is_provisional,
      'redeemed_at',        tr.redeemed_at,
      'occurred_at_device', tr.occurred_at_device,
      'synced_at',          tr.synced_at,
      'redeemed_by_name',   (select p.full_name from public.profiles p where p.id = tr.redeemed_by),
      'device_label',       (select d.label from public.staff_devices d where d.id = tr.device_id),
      'location_name',      (select l.name from public.locations l where l.id = tr.location_id),
      'entitlement_quantity', ba.quantity,
      'is_stale',           (tr.redeemed_at < now() - interval '48 hours')
    ) as item
  ) sub
  where (tr.is_over_redemption or tr.is_provisional)
    and tr.reviewed_at is null
    and not tr.is_reversal;

  return v_items;
end;
$$;

-- ---------------------------------------------------------------------------
-- device_list(): all registered devices, for the supervisor's management
-- screen. Active and inactive.
-- ---------------------------------------------------------------------------

create function public.device_list(p_device_id uuid, p_device_secret text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_device public.staff_devices;
begin
  if public.auth_role() is null
     or public.auth_role() not in ('admin', 'activity_supervisor') then
    raise exception 'Only a supervisor or an admin can manage devices.';
  end if;

  v_device := public.verified_device(p_device_id, p_device_secret);

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'device_id',     d.id,
      'label',         d.label,
      'location_name', (select l.name from public.locations l where l.id = d.location_id),
      'registered_at', d.registered_at,
      'last_seen_at',  d.last_seen_at,
      'is_active',     d.is_active
    ) order by d.is_active desc, d.label), '[]'::jsonb)
    from public.staff_devices d
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- deactivate_device(): a supervisor deactivates a lost or broken device.
-- The device's secret hash is cleared so even if someone knows it, no
-- function will accept it.
-- ---------------------------------------------------------------------------

create function public.deactivate_device(
  p_target_device_id uuid,
  p_device_id uuid,
  p_device_secret text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.staff_devices;
  v_target public.staff_devices;
begin
  if public.auth_role() is null
     or public.auth_role() not in ('admin', 'activity_supervisor') then
    raise exception 'Only a supervisor or an admin can deactivate a device.';
  end if;

  v_device := public.verified_device(p_device_id, p_device_secret);

  select * into v_target from public.staff_devices where id = p_target_device_id;
  if not found then
    raise exception 'That device does not exist.';
  end if;
  if not v_target.is_active then
    raise exception 'That device is already deactivated.';
  end if;

  update public.staff_devices
  set is_active = false, device_secret_hash = 'deactivated'
  where id = p_target_device_id;

  return jsonb_build_object('device_id', p_target_device_id, 'deactivated', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- shift_summary(): what this device has done today. Check-ins, redemptions
-- by activity, anything flagged.
-- ---------------------------------------------------------------------------

create function public.shift_summary(p_device_id uuid, p_device_secret text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_device public.staff_devices;
  v_today date;
  v_check_ins int;
  v_redemptions jsonb;
  v_flagged int;
begin
  if public.auth_role() is null
     or public.auth_role() not in ('admin', 'activity_supervisor', 'activity_staff') then
    raise exception 'Your role cannot use the island app.';
  end if;

  v_device := public.verified_device(p_device_id, p_device_secret);
  v_today := (now() at time zone 'Indian/Mauritius')::date;

  select count(*) into v_check_ins
  from public.bookings
  where checked_in_device_id = v_device.id
    and (checked_in_at at time zone 'Indian/Mauritius')::date = v_today;

  select coalesce(jsonb_agg(row_data order by row_data->>'activity_name'), '[]'::jsonb)
  into v_redemptions
  from (
    select jsonb_build_object(
      'activity_name', a.name,
      'total_redeemed', sum(tr.quantity_redeemed)
    ) as row_data
    from public.ticket_redemptions tr
    join public.booking_activities ba on ba.id = tr.booking_activity_id
    join public.activities a on a.id = ba.activity_id
    where tr.device_id = v_device.id
      and (tr.redeemed_at at time zone 'Indian/Mauritius')::date = v_today
      and not tr.is_reversal
    group by a.name
  ) sub;

  select count(*) into v_flagged
  from public.ticket_redemptions tr
  where tr.device_id = v_device.id
    and (tr.is_over_redemption or tr.is_provisional)
    and tr.reviewed_at is null
    and not tr.is_reversal;

  return jsonb_build_object(
    'device_label', v_device.label,
    'date', v_today,
    'check_ins', v_check_ins,
    'redemptions', v_redemptions,
    'flagged', v_flagged
  );
end;
$$;

-- Grants
revoke execute on function public.review_queue(uuid, text) from public, anon;
grant execute on function public.review_queue(uuid, text) to authenticated;

revoke execute on function public.device_list(uuid, text) from public, anon;
grant execute on function public.device_list(uuid, text) to authenticated;

revoke execute on function public.deactivate_device(uuid, uuid, text) from public, anon;
grant execute on function public.deactivate_device(uuid, uuid, text) to authenticated;

revoke execute on function public.shift_summary(uuid, text) from public, anon;
grant execute on function public.shift_summary(uuid, text) to authenticated;
