-- WP-16: booking detail support, payment corrections, amendments.

-- ---------------------------------------------------------------------------
-- staff_names(): id → name for office staff, so a booking can show who
-- created it and who took each payment (reception cannot read other
-- profiles). Names only; no roles, emails or status.
-- ---------------------------------------------------------------------------

create function public.staff_names(p_ids uuid[])
returns table (id uuid, full_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.full_name
  from public.profiles p
  where p.id = any (p_ids)
    and public.has_role(array['admin', 'accountant', 'receptionist']::public.app_role[]);
$$;

revoke execute on function public.staff_names(uuid[]) from public, anon;
grant execute on function public.staff_names(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- A correction can reverse at most what is left of the original payment.
-- ---------------------------------------------------------------------------

create or replace function public.check_payment_correction()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_original public.payments;
  v_corrected bigint;
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
  select coalesce(sum(amount_cents), 0) into v_corrected
  from public.payments where corrects_payment_id = v_original.id;
  if v_original.amount_cents + v_corrected + new.amount_cents < 0 then
    raise exception 'That would reverse more than is left of the original payment (Rs %).',
      to_char((v_original.amount_cents + v_corrected) / 100.0, 'FM999,999,990.00');
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- amend_booking(booking_id, payload): changes participants, lines, departure
-- time, meeting point, notes, boat and discount. Re-priced by build_quote()
-- for the booking's service date and operator; refused if the total the user
-- saw differs. Lines are matched by (package/activity, participant type):
-- unchanged lines are left alone, changed ones updated, new ones added and
-- removed ones deleted, so the audit log shows exactly what changed.
--
-- payload: {lines, discount?, participants, departure_time?, meeting_point?,
--           notes?, resource_id?, expected_total_cents}
-- ---------------------------------------------------------------------------

create function public.amend_booking(p_booking_id uuid, payload jsonb)
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
          delete from public.booking_activities where source_item_id = v_item_id;
          v_item.id := null; -- entitlements re-expanded below
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

revoke execute on function public.amend_booking(uuid, jsonb) from public, anon;
grant execute on function public.amend_booking(uuid, jsonb) to authenticated;
