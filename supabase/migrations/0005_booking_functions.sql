-- WP-06: booking references and atomic booking creation.

-- ---------------------------------------------------------------------------
-- next_booking_reference(): WS-YYYYMMDD-NNNN, counted per service date.
-- The upsert takes a row lock, so concurrent callers queue rather than
-- collide. Internal: only create_booking() calls it.
-- ---------------------------------------------------------------------------

create function public.next_booking_reference(p_service_date date)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_number int;
begin
  insert into public.booking_sequences as s (service_date, last_number)
  values (p_service_date, 1)
  on conflict (service_date) do update set last_number = s.last_number + 1
  returning s.last_number into v_number;

  return 'WS-' || to_char(p_service_date, 'YYYYMMDD') || '-'
    || lpad(v_number::text, greatest(4, length(v_number::text)), '0');
end;
$$;

revoke execute on function public.next_booking_reference(date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- create_booking(payload jsonb) → {booking_id, reference, created}
--
-- TRUSTS THE AMOUNTS IN ITS PAYLOAD. The only permitted caller is the
-- createBooking Server Action, which recomputes every price from
-- price_rules (src/lib/pricing) immediately before calling. Never call this
-- from anywhere that lets a browser supply amounts. It checks the payload is
-- internally consistent (line sums equal the totals), not that the prices
-- are right.
--
-- Payload:
--   idempotency_key text (required)
--   client_id uuid | client {first_name, last_name, phone_e164?, email?, country?}
--   source_type 'walk_in'|'operator', operator_id?, payer 'client'|'operator'
--   service_date date, departure_time?, meeting_point?, notes?, resource_id?
--   totals {retail_total_cents, charged_total_cents, discount_total_cents,
--           operator_net_total_cents, commission_total_cents}
--   items [{line_type, package_id?, activity_id?, participant_type, quantity,
--           unit_retail_cents, unit_charged_cents, unit_operator_net_cents?,
--           commission_rate?, commission_cents, discount_cents, discount_reason?,
--           price_rule_id?}]
--   participants [{participant_type, count}]
--   payment? {amount_cents, method, reference?, note?}
--
-- Errors are raised as sentences a receptionist can act on.
-- ---------------------------------------------------------------------------

create function public.create_booking(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := nullif(trim(payload ->> 'idempotency_key'), '');
  v_existing public.bookings;
  v_client_id uuid;
  v_source text := payload ->> 'source_type';
  v_operator public.tour_operators;
  v_payer text := coalesce(payload ->> 'payer', 'client');
  v_service_date date;
  v_resource_id uuid := nullif(payload ->> 'resource_id', '')::uuid;
  v_notes text := nullif(trim(payload ->> 'notes'), '');
  v_totals jsonb := payload -> 'totals';
  v_payment jsonb := payload -> 'payment';
  v_booking_id uuid;
  v_reference text;
  v_item jsonb;
  v_item_id uuid;
  v_sum_retail bigint := 0;
  v_sum_charged bigint := 0;
  v_sum_discount bigint := 0;
  v_sum_net bigint := 0;
  v_sum_commission bigint := 0;
  v_needs_boat boolean;
begin
  if not public.has_role(array['admin', 'receptionist']::public.app_role[]) then
    raise exception 'Only reception or an admin can create bookings.';
  end if;

  if v_key is null then
    raise exception 'The booking form did not send an idempotency key. Reload the page and try again.';
  end if;

  -- A double-click or retry returns the booking already made.
  select * into v_existing from public.bookings where idempotency_key = v_key;
  if found then
    return jsonb_build_object('booking_id', v_existing.id, 'reference', v_existing.reference, 'created', false);
  end if;

  -- Header checks
  v_service_date := (payload ->> 'service_date')::date;
  if v_service_date is null then
    raise exception 'Choose the service date.';
  end if;

  if v_source = 'walk_in' then
    if payload ->> 'operator_id' is not null or v_payer <> 'client' then
      raise exception 'A walk-in booking cannot have an operator.';
    end if;
  elsif v_source = 'operator' then
    select * into v_operator from public.tour_operators
    where id = (payload ->> 'operator_id')::uuid and is_active;
    if not found then
      raise exception 'Choose an active tour operator.';
    end if;
    if v_payer is distinct from v_operator.payer then
      raise exception 'Who pays for this booking has changed for %. Please review and try again.', v_operator.name;
    end if;
  else
    raise exception 'Choose walk-in or operator as the booking source.';
  end if;

  if jsonb_typeof(payload -> 'items') <> 'array' or jsonb_array_length(payload -> 'items') = 0 then
    raise exception 'Add at least one package or activity.';
  end if;
  if jsonb_typeof(payload -> 'participants') <> 'array' or jsonb_array_length(payload -> 'participants') = 0 then
    raise exception 'Add at least one participant.';
  end if;

  -- Line sums must equal the header totals.
  for v_item in select * from jsonb_array_elements(payload -> 'items') loop
    v_sum_retail := v_sum_retail + (v_item ->> 'unit_retail_cents')::bigint * (v_item ->> 'quantity')::int;
    v_sum_charged := v_sum_charged + (v_item ->> 'unit_charged_cents')::bigint * (v_item ->> 'quantity')::int;
    v_sum_net := v_sum_net + coalesce((v_item ->> 'unit_operator_net_cents')::bigint, 0) * (v_item ->> 'quantity')::int;
    v_sum_commission := v_sum_commission + coalesce((v_item ->> 'commission_cents')::bigint, 0);
    v_sum_discount := v_sum_discount + coalesce((v_item ->> 'discount_cents')::bigint, 0);
  end loop;

  if v_totals is null
    or (v_totals ->> 'retail_total_cents')::bigint is distinct from v_sum_retail
    or (v_totals ->> 'discount_total_cents')::bigint is distinct from v_sum_discount
    or (v_totals ->> 'charged_total_cents')::bigint is distinct from v_sum_charged - v_sum_discount
    or (v_totals ->> 'operator_net_total_cents')::bigint is distinct from v_sum_net
    or (v_totals ->> 'commission_total_cents')::bigint is distinct from v_sum_commission then
    raise exception 'The booking totals do not add up. Please review the booking and try again.';
  end if;
  if v_sum_charged - v_sum_discount < 0 then
    raise exception 'The discount is larger than the price.';
  end if;

  -- Fleet: anything that includes the catamaran needs a boat (capacity is
  -- warned about in the form, not enforced here).
  select exists (
    select 1
    from jsonb_array_elements(payload -> 'items') i
    left join public.package_activities pa
      on i ->> 'line_type' = 'package' and pa.package_id = (i ->> 'package_id')::uuid and not pa.is_optional
    join public.activities a
      on a.id = coalesce(pa.activity_id, case when i ->> 'line_type' = 'activity' then (i ->> 'activity_id')::uuid end)
    where a.code = 'CATAMARAN'
  ) into v_needs_boat;

  if v_needs_boat and v_resource_id is null then
    raise exception 'Assign a boat: this booking includes the catamaran.';
  end if;
  if v_resource_id is not null and not exists (
    select 1 from public.resources where id = v_resource_id and is_active
  ) then
    raise exception 'The chosen boat is not available. Pick another.';
  end if;

  if v_payment is not null and jsonb_typeof(v_payment) <> 'null' then
    if v_payer = 'operator' then
      raise exception 'Do not collect payment: % pays for this booking on account.', v_operator.name;
    end if;
    if coalesce((v_payment ->> 'amount_cents')::bigint, 0) <= 0 then
      raise exception 'Enter the amount received, or leave the payment out.';
    end if;
  else
    v_payment := null;
  end if;

  -- Client: existing, or new.
  if payload ->> 'client_id' is not null then
    v_client_id := (payload ->> 'client_id')::uuid;
    if not exists (select 1 from public.clients where id = v_client_id) then
      raise exception 'That client record no longer exists. Search for the client again.';
    end if;
  else
    if nullif(trim(payload #>> '{client,first_name}'), '') is null then
      raise exception 'Enter the client''s first name.';
    end if;
    begin
      insert into public.clients (first_name, last_name, phone_e164, email, country, created_by)
      values (
        trim(payload #>> '{client,first_name}'),
        coalesce(trim(payload #>> '{client,last_name}'), ''),
        nullif(trim(payload #>> '{client,phone_e164}'), ''),
        nullif(trim(payload #>> '{client,email}'), ''),
        nullif(trim(payload #>> '{client,country}'), ''),
        auth.uid()
      )
      returning id into v_client_id;
    exception when unique_violation then
      raise exception 'A client with phone % already exists. Use the existing client.', payload #>> '{client,phone_e164}';
    end;
  end if;

  if v_service_date < public.today_mauritius() then
    v_notes := concat_ws(E'\n', 'Backdated entry, created ' || to_char(public.today_mauritius(), 'FMDD Mon YYYY') || '.', v_notes);
  end if;

  v_reference := public.next_booking_reference(v_service_date);

  begin
    insert into public.bookings (
      reference, client_id, source_type, operator_id, resource_id, service_date, departure_time, meeting_point,
      retail_total_cents, charged_total_cents, discount_total_cents, operator_net_total_cents, commission_total_cents,
      payer, notes, idempotency_key, created_by
    ) values (
      v_reference, v_client_id, v_source, v_operator.id, v_resource_id, v_service_date,
      nullif(payload ->> 'departure_time', '')::time, nullif(trim(payload ->> 'meeting_point'), ''),
      v_sum_retail, v_sum_charged - v_sum_discount, v_sum_discount, v_sum_net, v_sum_commission,
      v_payer, v_notes, v_key, auth.uid()
    )
    returning id into v_booking_id;
  exception when unique_violation then
    -- A concurrent retry with the same key won the race: return its booking.
    select * into v_existing from public.bookings where idempotency_key = v_key;
    if found then
      return jsonb_build_object('booking_id', v_existing.id, 'reference', v_existing.reference, 'created', false);
    end if;
    raise;
  end;

  for v_item in select * from jsonb_array_elements(payload -> 'items') loop
    insert into public.booking_items (
      booking_id, line_type, package_id, activity_id, participant_type, quantity,
      unit_retail_cents, unit_charged_cents, unit_operator_net_cents, commission_rate, commission_cents,
      discount_cents, discount_reason, price_rule_id, sort_order
    ) values (
      v_booking_id, v_item ->> 'line_type', (v_item ->> 'package_id')::uuid, (v_item ->> 'activity_id')::uuid,
      (v_item ->> 'participant_type')::public.participant_type, (v_item ->> 'quantity')::int,
      (v_item ->> 'unit_retail_cents')::bigint, (v_item ->> 'unit_charged_cents')::bigint,
      (v_item ->> 'unit_operator_net_cents')::bigint, (v_item ->> 'commission_rate')::numeric,
      coalesce((v_item ->> 'commission_cents')::bigint, 0), coalesce((v_item ->> 'discount_cents')::bigint, 0),
      nullif(trim(v_item ->> 'discount_reason'), ''), (v_item ->> 'price_rule_id')::uuid,
      coalesce((v_item ->> 'sort_order')::int, 100)
    )
    returning id into v_item_id;

    -- Entitlements: a package line confers each of its non-optional
    -- activities; an activity line confers itself.
    if v_item ->> 'line_type' = 'package' then
      insert into public.booking_activities (booking_id, activity_id, quantity, source_item_id)
      select v_booking_id, pa.activity_id, pa.quantity_per_participant * (v_item ->> 'quantity')::int, v_item_id
      from public.package_activities pa
      where pa.package_id = (v_item ->> 'package_id')::uuid and not pa.is_optional;
      if not found then
        raise exception 'This package has no activities configured. Ask an admin to fix it.';
      end if;
    else
      insert into public.booking_activities (booking_id, activity_id, quantity, source_item_id)
      values (v_booking_id, (v_item ->> 'activity_id')::uuid, (v_item ->> 'quantity')::int, v_item_id);
    end if;
  end loop;

  insert into public.booking_participants (booking_id, participant_type, count)
  select v_booking_id, (p ->> 'participant_type')::public.participant_type, (p ->> 'count')::int
  from jsonb_array_elements(payload -> 'participants') p
  where (p ->> 'count')::int > 0;

  insert into public.tickets (booking_id) values (v_booking_id);

  if v_payment is not null then
    insert into public.payments (booking_id, amount_cents, method, received_from, reference, note, recorded_by)
    values (
      v_booking_id, (v_payment ->> 'amount_cents')::bigint, (v_payment ->> 'method')::public.payment_method,
      'client', nullif(trim(v_payment ->> 'reference'), ''), nullif(trim(v_payment ->> 'note'), ''), auth.uid()
    );
  end if;

  return jsonb_build_object('booking_id', v_booking_id, 'reference', v_reference, 'created', true);
end;
$$;

revoke execute on function public.create_booking(jsonb) from public, anon;
grant execute on function public.create_booking(jsonb) to authenticated;
