-- WP-23 (V2): the redemption engine. V2's equivalent of the pricing engine:
-- the part most likely to be built wrong, so it follows the V2 plan's
-- section 6 exactly. Island devices, reception and admins redeem, check in
-- and reverse only through these functions; nobody writes the tables.
--
-- The rule "redemptions for one entitlement never exceed its quantity" spans
-- rows, so no constraint can hold it. It holds because every write locks the
-- entitlement row (select ... for update) before summing. Without that lock
-- two simultaneous scans at the lunch queue both see one lunch left.

-- ---------------------------------------------------------------------------
-- Entitlements that carry redemptions: never deleted, never reduced below
-- what was redeemed. Amending a booking now scales entitlements in place
-- (amend_booking below) so their ids, and the redemptions on them, survive.
-- ---------------------------------------------------------------------------

create function public.guard_redeemed_entitlement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_redeemed int;
  v_name text;
begin
  select coalesce(sum(quantity_redeemed), 0)::int into v_redeemed
  from public.ticket_redemptions where booking_activity_id = old.id;
  select name into v_name from public.activities where id = old.activity_id;

  if tg_op = 'DELETE' then
    if exists (select 1 from public.ticket_redemptions where booking_activity_id = old.id) then
      raise exception '% has already been redeemed on this booking, so that line cannot be removed.', v_name;
    end if;
    return old;
  end if;
  if new.quantity < v_redeemed then
    raise exception '% x % already redeemed on this booking, so it cannot go below %.', v_redeemed, v_name, v_redeemed;
  end if;
  return new;
end;
$$;

create trigger booking_activities_guard_redeemed
  before update of quantity or delete on public.booking_activities
  for each row execute function public.guard_redeemed_entitlement();

-- The one change to V1's amend_booking(): entitlements are scaled in place
-- instead of being deleted and re-expanded when a line's quantity changes.
create or replace function public.amend_booking(p_booking_id uuid, payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_role public.app_role := public.auth_role();
  v_quote jsonb;
  v_line jsonb;
  v_item public.booking_items;
  v_item_id uuid;
  v_kept uuid[] := '{}';
  v_needs_boat boolean;
  v_resource_id uuid := nullif(payload ->> 'resource_id', '')::uuid;
  v_paid bigint;
begin
  if v_role is null or v_role not in ('admin', 'receptionist') then
    raise exception 'Only reception or an admin can amend bookings.';
  end if;
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'That booking no longer exists.';
  end if;
  if v_booking.status = 'cancelled' then
    raise exception 'A cancelled booking cannot be amended. Create a new booking instead.';
  end if;
  if v_role = 'receptionist' and v_booking.service_date < public.today_mauritius() then
    raise exception 'This booking''s date has passed, so only an admin can amend it. That protects days whose cash is already counted.';
  end if;

  v_quote := public.build_quote(jsonb_build_object(
    'service_date', v_booking.service_date,
    'operator_id', v_booking.operator_id,
    'lines', payload -> 'lines',
    'discount', payload -> 'discount'
  ));
  if (payload ->> 'expected_total_cents') is null
    or (payload ->> 'expected_total_cents')::bigint is distinct from (v_quote ->> 'charged_total_cents')::bigint then
    raise exception 'Prices changed while you were editing. Please review the total and save again.';
  end if;
  if jsonb_typeof(payload -> 'participants') is distinct from 'array'
    or not exists (select 1 from jsonb_array_elements(payload -> 'participants') p where (p ->> 'count')::int > 0) then
    raise exception 'Add at least one participant.';
  end if;

  select exists (
    select 1
    from jsonb_array_elements(v_quote -> 'lines') l
    left join public.package_activities pa on pa.package_id = (l ->> 'package_id')::uuid and not pa.is_optional
    join public.activities a on a.id = coalesce(pa.activity_id, (l ->> 'activity_id')::uuid)
    where a.code = 'CATAMARAN'
  ) into v_needs_boat;
  if v_needs_boat and v_resource_id is null then
    raise exception 'Assign a boat: this booking includes the catamaran.';
  end if;
  if v_resource_id is not null and v_resource_id is distinct from v_booking.resource_id
    and not exists (select 1 from public.resources where id = v_resource_id and is_active) then
    raise exception 'The chosen boat is not available. Pick another.';
  end if;

  select coalesce(sum(amount_cents), 0) into v_paid from public.payments where booking_id = p_booking_id;
  if v_booking.payer = 'client' and v_paid > (v_quote ->> 'charged_total_cents')::bigint then
    raise exception 'The new total (Rs %) is less than what was already paid (Rs %). Record a refund as a payment correction first.',
      to_char((v_quote ->> 'charged_total_cents')::bigint / 100.0, 'FM999,999,990'), to_char(v_paid / 100.0, 'FM999,999,990');
  end if;

  -- Lines: match on (package/activity, participant type).
  for v_line in select * from jsonb_array_elements(v_quote -> 'lines') loop
    select * into v_item from public.booking_items
    where booking_id = p_booking_id
      and package_id is not distinct from (v_line ->> 'package_id')::uuid
      and activity_id is not distinct from (v_line ->> 'activity_id')::uuid
      and participant_type = (v_line ->> 'participant_type')::public.participant_type;

    if found then
      v_item_id := v_item.id;
      if (v_item.quantity, v_item.unit_retail_cents, v_item.unit_charged_cents, v_item.unit_operator_net_cents,
          v_item.commission_rate, v_item.commission_cents, v_item.discount_cents, v_item.discount_reason, v_item.price_rule_id)
         is distinct from
         ((v_line ->> 'quantity')::int, (v_line ->> 'unit_retail_cents')::bigint, (v_line ->> 'unit_charged_cents')::bigint,
          (v_line ->> 'unit_operator_net_cents')::bigint, (v_line ->> 'commission_rate')::numeric,
          (v_line ->> 'commission_cents')::bigint, (v_line ->> 'discount_cents')::bigint, v_line ->> 'discount_reason',
          (v_line ->> 'price_rule_id')::uuid) then
        update public.booking_items set
          quantity = (v_line ->> 'quantity')::int,
          unit_retail_cents = (v_line ->> 'unit_retail_cents')::bigint,
          unit_charged_cents = (v_line ->> 'unit_charged_cents')::bigint,
          unit_operator_net_cents = (v_line ->> 'unit_operator_net_cents')::bigint,
          commission_rate = (v_line ->> 'commission_rate')::numeric,
          commission_cents = (v_line ->> 'commission_cents')::bigint,
          discount_cents = (v_line ->> 'discount_cents')::bigint,
          discount_reason = v_line ->> 'discount_reason',
          price_rule_id = (v_line ->> 'price_rule_id')::uuid,
          sort_order = (v_line ->> 'sort_order')::int
        where id = v_item_id;
        if v_item.quantity is distinct from (v_line ->> 'quantity')::int then
          -- Scale this line's own entitlements in place (each row is
          -- per-participant quantity x line quantity, so this is exact).
          -- Their ids carry any redemptions, and the package's composition
          -- comes from the booking's history, not from today's package.
          update public.booking_activities
          set quantity = quantity / v_item.quantity * (v_line ->> 'quantity')::int
          where source_item_id = v_item_id;
        end if;
      end if;
    else
      insert into public.booking_items (
        booking_id, line_type, package_id, activity_id, participant_type, quantity,
        unit_retail_cents, unit_charged_cents, unit_operator_net_cents, commission_rate, commission_cents,
        discount_cents, discount_reason, price_rule_id, sort_order
      ) values (
        p_booking_id, v_line ->> 'line_type', (v_line ->> 'package_id')::uuid, (v_line ->> 'activity_id')::uuid,
        (v_line ->> 'participant_type')::public.participant_type, (v_line ->> 'quantity')::int,
        (v_line ->> 'unit_retail_cents')::bigint, (v_line ->> 'unit_charged_cents')::bigint,
        (v_line ->> 'unit_operator_net_cents')::bigint, (v_line ->> 'commission_rate')::numeric,
        (v_line ->> 'commission_cents')::bigint, (v_line ->> 'discount_cents')::bigint,
        v_line ->> 'discount_reason', (v_line ->> 'price_rule_id')::uuid, (v_line ->> 'sort_order')::int
      )
      returning id into v_item_id;
      v_item.id := null;
    end if;
    v_kept := array_append(v_kept, v_item_id);

    if v_item.id is null then
      if v_line ->> 'line_type' = 'package' then
        insert into public.booking_activities (booking_id, activity_id, quantity, source_item_id)
        select p_booking_id, pa.activity_id, pa.quantity_per_participant * (v_line ->> 'quantity')::int, v_item_id
        from public.package_activities pa
        where pa.package_id = (v_line ->> 'package_id')::uuid and not pa.is_optional;
      else
        insert into public.booking_activities (booking_id, activity_id, quantity, source_item_id)
        values (p_booking_id, (v_line ->> 'activity_id')::uuid, (v_line ->> 'quantity')::int, v_item_id);
      end if;
    end if;
  end loop;

  -- Lines no longer on the booking (their entitlements cascade). Audited.
  delete from public.booking_items where booking_id = p_booking_id and not (id = any (v_kept));

  -- Participants
  delete from public.booking_participants
  where booking_id = p_booking_id
    and participant_type not in (
      select (p ->> 'participant_type')::public.participant_type
      from jsonb_array_elements(payload -> 'participants') p where (p ->> 'count')::int > 0
    );
  insert into public.booking_participants (booking_id, participant_type, count)
  select p_booking_id, (p ->> 'participant_type')::public.participant_type, (p ->> 'count')::int
  from jsonb_array_elements(payload -> 'participants') p
  where (p ->> 'count')::int > 0
  on conflict (booking_id, participant_type) do update set count = excluded.count
    where booking_participants.count is distinct from excluded.count;

  update public.bookings set
    retail_total_cents = (v_quote ->> 'retail_total_cents')::bigint,
    charged_total_cents = (v_quote ->> 'charged_total_cents')::bigint,
    discount_total_cents = (v_quote ->> 'discount_total_cents')::bigint,
    operator_net_total_cents = (v_quote ->> 'operator_net_total_cents')::bigint,
    commission_total_cents = (v_quote ->> 'commission_total_cents')::bigint,
    departure_time = nullif(payload ->> 'departure_time', '')::time,
    meeting_point = nullif(trim(payload ->> 'meeting_point'), ''),
    notes = nullif(trim(payload ->> 'notes'), ''),
    resource_id = case when v_needs_boat then v_resource_id else null end
  where id = p_booking_id
    and (retail_total_cents, charged_total_cents, discount_total_cents, operator_net_total_cents, commission_total_cents,
         departure_time, meeting_point, notes, resource_id)
        is distinct from
        ((v_quote ->> 'retail_total_cents')::bigint, (v_quote ->> 'charged_total_cents')::bigint,
         (v_quote ->> 'discount_total_cents')::bigint, (v_quote ->> 'operator_net_total_cents')::bigint,
         (v_quote ->> 'commission_total_cents')::bigint, nullif(payload ->> 'departure_time', '')::time,
         nullif(trim(payload ->> 'meeting_point'), ''), nullif(trim(payload ->> 'notes'), ''),
         case when v_needs_boat then v_resource_id else null end);

  return jsonb_build_object(
    'previous_total_cents', v_booking.charged_total_cents,
    'charged_total_cents', (v_quote ->> 'charged_total_cents')::bigint,
    'paid_cents', v_paid
  );
end;
$$;
-- ---------------------------------------------------------------------------
-- Check-in idempotency: the device's request id, so a retried check-in is
-- recognised as the same request (V2 plan §6.3).
-- ---------------------------------------------------------------------------

alter table public.bookings add column checked_in_client_uuid uuid;
create unique index bookings_checked_in_client_uuid_idx on public.bookings (checked_in_client_uuid)
  where checked_in_client_uuid is not null;

-- ---------------------------------------------------------------------------
-- Internal helpers. Not granted to anyone: only the functions below call them.
-- ---------------------------------------------------------------------------

-- The device making the call, verified by its secret. Island roles always
-- work from a registered device (it is their unit of accountability); office
-- staff may call from an unregistered desk. A deactivated device stops at
-- once, whatever its session says. Unknown id and wrong secret get the same
-- message, so the answer reveals nothing.
create function public.verified_device(p_device_id uuid, p_device_secret text)
returns public.staff_devices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.staff_devices;
begin
  if p_device_id is null then
    if public.auth_role() in ('activity_staff', 'activity_supervisor') then
      raise exception 'This device is not registered. Ask a supervisor to register it.';
    end if;
    return null;
  end if;

  select * into v_device from public.staff_devices where id = p_device_id;
  if not found or v_device.device_secret_hash is distinct from encode(extensions.digest(coalesce(p_device_secret, ''), 'sha256'), 'hex') then
    raise exception 'This device is not recognised. Ask a supervisor to register it again.';
  end if;
  if not v_device.is_active then
    raise exception 'This device has been deactivated. Ask a supervisor.';
  end if;

  update public.staff_devices set last_seen_at = now() where id = v_device.id;
  return v_device;
end;
$$;

-- The business date an event belongs to. Online: today. From an offline
-- queue: the day the device says it happened (never later than now), so a
-- lunch redeemed at 16:00 and synced after midnight is still that day's.
create function public.event_business_date(p_occurred_at_device timestamptz, p_from_queue boolean)
returns date
language sql
stable
set search_path = ''
as $$
  select case
    when p_from_queue and p_occurred_at_device is not null
      then (least(p_occurred_at_device, now()) at time zone 'Indian/Mauritius')::date
    else public.today_mauritius()
  end;
$$;

-- Refuses a booking that cannot be redeemed or checked in on p_date, with the
-- same readable sentences the scan verdicts use.
create function public.assert_booking_usable(p_booking public.bookings, p_date date)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_booking.status = 'cancelled' then
    raise exception 'Booking % was cancelled. Send the customer to reception.', p_booking.reference;
  end if;
  if p_booking.status <> 'confirmed' then
    raise exception 'Booking % is marked %. Send the customer to reception.', p_booking.reference, replace(p_booking.status::text, '_', '-');
  end if;
  if not exists (select 1 from public.tickets where booking_id = p_booking.id and revoked_at is null) then
    raise exception 'This ticket for % was replaced by a newer one. Ask the customer to check for a later message.', p_booking.reference;
  end if;
  if p_booking.service_date <> p_date then
    raise exception 'Booking % is for %, not today. Send the customer to reception.',
      p_booking.reference, to_char(p_booking.service_date, 'FMDD Mon YYYY');
  end if;
end;
$$;

-- A booking's redeemable entitlements with what has gone, and when, by whom
-- and where. Explicit columns only: no price, total, contact or note, so the
-- payload cannot leak when someone adds a column to a table.
create function public.booking_entitlements(p_booking_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(e.entitlement order by e.sort_order, e.activity_name, e.participant_order), '[]'::jsonb)
  from (
    select
      a.sort_order,
      a.name as activity_name,
      array_position(array['adult', 'child', 'infant'], bi.participant_type::text) as participant_order,
      jsonb_build_object(
        'booking_activity_id', ba.id,
        'activity_code', a.code,
        'activity_name', a.name,
        'participant_type', bi.participant_type,
        'quantity', ba.quantity,
        'redeemed', coalesce(r.redeemed, 0),
        'remaining', greatest(ba.quantity - coalesce(r.redeemed, 0), 0),
        'last_event', r.last_event,
        'events', coalesce(r.events, '[]'::jsonb)
      ) as entitlement
    from public.booking_activities ba
    join public.activities a on a.id = ba.activity_id
    left join public.booking_items bi on bi.id = ba.source_item_id
    left join lateral (
      select
        sum(tr.quantity_redeemed)::int as redeemed,
        (array_agg(jsonb_build_object('at', tr.redeemed_at, 'by_name', p.full_name, 'location_name', l.name)
           order by tr.redeemed_at desc)
           filter (where not tr.is_reversal
                   and not exists (select 1 from public.ticket_redemptions rv where rv.reverses_redemption_id = tr.id)))[1]
          as last_event,
        jsonb_agg(jsonb_build_object(
          'redemption_id', tr.id,
          'quantity', tr.quantity_redeemed,
          'at', tr.redeemed_at,
          'occurred_at_device', tr.occurred_at_device,
          'by_name', p.full_name,
          'location_name', l.name,
          'device_label', d.label,
          'is_reversal', tr.is_reversal,
          'is_over_redemption', tr.is_over_redemption
        ) order by tr.redeemed_at) as events
      from public.ticket_redemptions tr
      left join public.profiles p on p.id = tr.redeemed_by
      left join public.locations l on l.id = tr.location_id
      left join public.staff_devices d on d.id = tr.device_id
      where tr.booking_activity_id = ba.id
    ) r on true
    where ba.booking_id = p_booking_id and a.is_redeemable
  ) e;
$$;

-- The figures redeem_activity() returns, for one entitlement after a write.
create function public.redemption_result(p_redemption public.ticket_redemptions, p_already_applied boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'redemption_id', p_redemption.id,
    'booking_activity_id', ba.id,
    'entitlement_quantity', ba.quantity,
    'redeemed_total', t.total,
    'remaining', greatest(ba.quantity - t.total, 0),
    'is_over_redemption', p_redemption.is_over_redemption,
    'already_applied', p_already_applied
  )
  from public.booking_activities ba
  cross join lateral (
    select coalesce(sum(quantity_redeemed), 0)::int as total
    from public.ticket_redemptions where booking_activity_id = ba.id
  ) t
  where ba.id = p_redemption.booking_activity_id;
$$;

-- The reversal itself, without the caller's time window: shared by
-- reverse_redemption() and resolve_over_redemption(). The caller has checked
-- the role; this checks the redemption and the reason.
create function public.apply_reversal(
  p_redemption_id uuid,
  p_reason text,
  p_device public.staff_devices,
  p_location_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_original public.ticket_redemptions;
  v_reversal public.ticket_redemptions;
begin
  if nullif(trim(p_reason), '') is null then
    raise exception 'Give a reason for reversing this redemption.';
  end if;
  select * into v_original from public.ticket_redemptions where id = p_redemption_id;
  if not found then
    raise exception 'That redemption does not exist.';
  end if;
  -- The same lock redeem_activity() takes, so a reversal and a redemption
  -- on one entitlement cannot interleave.
  perform 1 from public.booking_activities where id = v_original.booking_activity_id for update;
  if v_original.is_reversal then
    raise exception 'This is already a reversal. Reverse the original redemption instead.';
  end if;
  if exists (select 1 from public.ticket_redemptions where reverses_redemption_id = p_redemption_id) then
    raise exception 'This redemption has already been reversed.';
  end if;

  insert into public.ticket_redemptions (
    booking_id, booking_activity_id, activity_id, quantity_redeemed, redeemed_by, device_id, location_id,
    client_uuid, is_reversal, reverses_redemption_id, note
  ) values (
    v_original.booking_id, v_original.booking_activity_id, v_original.activity_id, -v_original.quantity_redeemed,
    auth.uid(), p_device.id, coalesce(p_location_id, p_device.location_id),
    gen_random_uuid(), true, v_original.id, trim(p_reason)
  )
  returning * into v_reversal;

  return public.redemption_result(v_reversal, false) || jsonb_build_object('reverses_redemption_id', v_original.id);
end;
$$;

revoke execute on function public.guard_redeemed_entitlement() from public, anon, authenticated;
revoke execute on function public.verified_device(uuid, text) from public, anon, authenticated;
revoke execute on function public.event_business_date(timestamptz, boolean) from public, anon, authenticated;
revoke execute on function public.assert_booking_usable(public.bookings, date) from public, anon, authenticated;
revoke execute on function public.booking_entitlements(uuid) from public, anon, authenticated;
revoke execute on function public.redemption_result(public.ticket_redemptions, boolean) from public, anon, authenticated;
revoke execute on function public.apply_reversal(uuid, text, public.staff_devices, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- redeem_activity(): V2 plan §6.1-6.2 and WP-23 step 1, in that order.
--
-- p_from_queue marks a redemption recorded offline and synced later. It
-- physically happened, so if it takes the entitlement past its quantity it is
-- inserted anyway and flagged for a supervisor (§7.4), not rejected.
-- ---------------------------------------------------------------------------

create function public.redeem_activity(
  p_booking_activity_id uuid,
  p_quantity int,
  p_client_uuid uuid,
  p_location_id uuid default null,
  p_device_id uuid default null,
  p_device_secret text default null,
  p_occurred_at_device timestamptz default null,
  p_note text default null,
  p_from_queue boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.ticket_redemptions;
  v_device public.staff_devices;
  v_entitlement public.booking_activities;
  v_booking public.bookings;
  v_activity public.activities;
  v_redeemed int;
  v_remaining int;
  v_over boolean;
  v_redemption public.ticket_redemptions;
begin
  -- a. who may redeem
  if public.auth_role() is null
     or public.auth_role() not in ('admin', 'receptionist', 'activity_supervisor', 'activity_staff') then
    raise exception 'Your role cannot redeem activities.';
  end if;
  if p_client_uuid is null then
    raise exception 'This request has no id. Update the app and try again.';
  end if;

  -- b. a retry of a request that already landed returns it; it is not an error
  select * into v_existing from public.ticket_redemptions where client_uuid = p_client_uuid;
  if found then
    if v_existing.booking_activity_id is distinct from p_booking_activity_id then
      raise exception 'This request id was already used for a different redemption.';
    end if;
    return public.redemption_result(v_existing, true);
  end if;

  v_device := public.verified_device(p_device_id, p_device_secret);

  -- c. the lock that makes two simultaneous scans safe
  select * into v_entitlement from public.booking_activities where id = p_booking_activity_id for update;
  if not found then
    raise exception 'That activity is not on this booking.';
  end if;
  -- a duplicate that raced us here has landed while we waited for the lock
  select * into v_existing from public.ticket_redemptions where client_uuid = p_client_uuid;
  if found then
    return public.redemption_result(v_existing, true);
  end if;

  select * into v_activity from public.activities where id = v_entitlement.activity_id;
  if not v_activity.is_redeemable then
    raise exception '% is not redeemed on the ticket.', v_activity.name;
  end if;
  if p_quantity is null or p_quantity < 1 then
    raise exception 'Redeem at least one.';
  end if;

  -- d. the booking, its date and its ticket
  select * into v_booking from public.bookings where id = v_entitlement.booking_id;
  perform public.assert_booking_usable(v_booking, public.event_business_date(p_occurred_at_device, p_from_queue));

  -- e. what has gone already; reversals are negative and subtract
  select coalesce(sum(quantity_redeemed), 0)::int into v_redeemed
  from public.ticket_redemptions where booking_activity_id = v_entitlement.id;
  v_remaining := v_entitlement.quantity - v_redeemed;

  -- f. never more than the entitlement online; offline, record and flag
  v_over := v_redeemed + p_quantity > v_entitlement.quantity;
  if v_over and not p_from_queue then
    if v_remaining <= 0 then
      raise exception 'No % remaining on %: all % have been redeemed.', v_activity.name, v_booking.reference, v_entitlement.quantity;
    end if;
    raise exception 'Only % % remaining on %. You asked for %.', v_remaining, v_activity.name, v_booking.reference, p_quantity;
  end if;

  -- g. both timestamps: when the device says, and when the server heard
  insert into public.ticket_redemptions (
    booking_id, booking_activity_id, activity_id, quantity_redeemed, occurred_at_device,
    redeemed_by, device_id, location_id, client_uuid, is_over_redemption, note
  ) values (
    v_booking.id, v_entitlement.id, v_entitlement.activity_id, p_quantity, p_occurred_at_device,
    auth.uid(), v_device.id, coalesce(p_location_id, v_device.location_id), p_client_uuid, v_over,
    nullif(trim(p_note), '')
  )
  returning * into v_redemption;

  -- h. every figure, so the device updates without a second round trip
  return public.redemption_result(v_redemption, false);
end;
$$;

-- ---------------------------------------------------------------------------
-- check_in_booking(): the party has arrived (§6.3). Idempotent twice over: a
-- retried request (same p_client_uuid) is recognised, and a second check-in
-- from anywhere returns the original arrival time instead of overwriting it.
-- Returns the entitlements so the device shows them without another call.
-- ---------------------------------------------------------------------------

create function public.check_in_booking(
  p_booking_id uuid,
  p_client_uuid uuid,
  p_location_id uuid default null,
  p_device_id uuid default null,
  p_device_secret text default null,
  p_occurred_at_device timestamptz default null,
  p_from_queue boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.staff_devices;
  v_booking public.bookings;
  v_already boolean;
begin
  if public.auth_role() is null
     or public.auth_role() not in ('admin', 'receptionist', 'activity_supervisor', 'activity_staff') then
    raise exception 'Your role cannot check parties in.';
  end if;
  if p_client_uuid is null then
    raise exception 'This request has no id. Update the app and try again.';
  end if;
  v_device := public.verified_device(p_device_id, p_device_secret);

  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'That booking does not exist.';
  end if;

  v_already := v_booking.checked_in_at is not null;
  if not v_already then
    perform public.assert_booking_usable(v_booking, public.event_business_date(p_occurred_at_device, p_from_queue));
    update public.bookings set
      checked_in_at = case when p_from_queue then least(coalesce(p_occurred_at_device, now()), now()) else now() end,
      checked_in_by = auth.uid(),
      checked_in_device_id = v_device.id,
      checked_in_location_id = coalesce(p_location_id, v_device.location_id),
      checked_in_client_uuid = p_client_uuid
    where id = p_booking_id
    returning * into v_booking;
  end if;

  return jsonb_build_object(
    'booking_id', v_booking.id,
    'reference', v_booking.reference,
    'checked_in_at', v_booking.checked_in_at,
    'checked_in_by_name', (select full_name from public.profiles where id = v_booking.checked_in_by),
    'checked_in_location_name', (select name from public.locations where id = v_booking.checked_in_location_id),
    'already_checked_in', v_already,
    'already_applied', v_booking.checked_in_client_uuid is not distinct from p_client_uuid and v_already,
    'entitlements', public.booking_entitlements(v_booking.id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- reverse_redemption(): a mistake is reversed by a negative row; nothing is
-- deleted and both rows stay visible (§6.4). Who may reverse depends on age:
--   - the person who redeemed it, within a minute: the UNDO on the row
--     (the app offers 30 seconds; the extra covers a slow connection);
--   - a supervisor, within 24 hours (WP-30);
--   - an admin, any time.
-- ---------------------------------------------------------------------------

create function public.reverse_redemption(
  p_redemption_id uuid,
  p_reason text,
  p_location_id uuid default null,
  p_device_id uuid default null,
  p_device_secret text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.app_role := public.auth_role();
  v_original public.ticket_redemptions;
  v_device public.staff_devices;
begin
  if v_role is null or v_role not in ('admin', 'receptionist', 'activity_supervisor', 'activity_staff') then
    raise exception 'Your role cannot reverse redemptions.';
  end if;
  select * into v_original from public.ticket_redemptions where id = p_redemption_id;
  if not found then
    raise exception 'That redemption does not exist.';
  end if;

  if v_role = 'admin' then
    null;
  elsif v_role = 'activity_supervisor' and v_original.redeemed_at > now() - interval '24 hours' then
    null;
  elsif v_role = 'activity_supervisor' then
    raise exception 'This redemption is more than 24 hours old. Only an admin can reverse it now.';
  elsif v_original.redeemed_by = auth.uid() and v_original.redeemed_at > now() - interval '60 seconds' then
    null;
  else
    raise exception 'Only a supervisor can reverse this redemption now. Ask them.';
  end if;

  v_device := public.verified_device(p_device_id, p_device_secret);
  return public.apply_reversal(p_redemption_id, p_reason, v_device, p_location_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- resolve_over_redemption(): a supervisor settles a flagged row (§7.4).
-- 'accept': the party really received more than their entitlement (chase it
-- or write it off). 'reverse': it was a mis-scan. Both need a note, and both
-- are recorded on the row. No 24-hour limit: a flag raised on Saturday is
-- still the supervisor's to settle on Monday.
-- ---------------------------------------------------------------------------

create function public.resolve_over_redemption(
  p_redemption_id uuid,
  p_action text,
  p_note text,
  p_location_id uuid default null,
  p_device_id uuid default null,
  p_device_secret text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_original public.ticket_redemptions;
  v_device public.staff_devices;
  v_reversal jsonb;
begin
  if public.auth_role() is null or public.auth_role() not in ('admin', 'activity_supervisor') then
    raise exception 'Only a supervisor or an admin can resolve a flagged redemption.';
  end if;
  if p_action is null or p_action not in ('accept', 'reverse') then
    raise exception 'Choose accept or reverse.';
  end if;
  if nullif(trim(p_note), '') is null then
    raise exception 'Add a note saying what happened.';
  end if;
  v_device := public.verified_device(p_device_id, p_device_secret);

  select * into v_original from public.ticket_redemptions where id = p_redemption_id;
  if not found then
    raise exception 'That redemption does not exist.';
  end if;
  perform 1 from public.booking_activities where id = v_original.booking_activity_id for update;
  select * into v_original from public.ticket_redemptions where id = p_redemption_id;
  if not (v_original.is_over_redemption or v_original.is_provisional) then
    raise exception 'This redemption is not flagged for review.';
  end if;
  if v_original.reviewed_at is not null then
    raise exception 'This redemption has already been reviewed.';
  end if;

  if p_action = 'reverse' then
    v_reversal := public.apply_reversal(p_redemption_id, p_note, v_device, p_location_id);
  end if;
  update public.ticket_redemptions
  set reviewed_by = auth.uid(), reviewed_at = now(), review_note = trim(p_note)
  where id = p_redemption_id;

  return jsonb_build_object('redemption_id', p_redemption_id, 'action', p_action, 'reversal', v_reversal);
end;
$$;

revoke execute on function public.redeem_activity(uuid, int, uuid, uuid, uuid, text, timestamptz, text, boolean) from public, anon;
revoke execute on function public.check_in_booking(uuid, uuid, uuid, uuid, text, timestamptz, boolean) from public, anon;
revoke execute on function public.reverse_redemption(uuid, text, uuid, uuid, text) from public, anon;
revoke execute on function public.resolve_over_redemption(uuid, text, text, uuid, uuid, text) from public, anon;
grant execute on function public.redeem_activity(uuid, int, uuid, uuid, uuid, text, timestamptz, text, boolean) to authenticated;
grant execute on function public.check_in_booking(uuid, uuid, uuid, uuid, text, timestamptz, boolean) to authenticated;
grant execute on function public.reverse_redemption(uuid, text, uuid, uuid, text) to authenticated;
grant execute on function public.resolve_over_redemption(uuid, text, text, uuid, uuid, text) to authenticated;
