-- WP-14: the pricing engine, in the database.
--
-- build_quote() resolves every price from price_rules and applies the
-- operator's settlement model and any discount. create_booking() calls it
-- itself and writes its figures: a booking's money never comes from the
-- request. The browser only ever sends what was chosen (lines, quantities,
-- discount) and the total it displayed, so a price change mid-booking is
-- caught. (Approved change to the build plan: see CLAUDE.md, WP-14.)
--
-- Rules (build plan §6, WP-14):
--  1. An operator-specific rule for the service date, else the walk-in rule,
--     else an error naming the item, participant type and date. Never zero.
--  2. A 'components' package sums its non-optional activities (× quantity
--     per participant); a 'bundle' package resolves its own rule.
--  3. Settlement: net_rate → charged = net (retail, with a warning, when no
--     net price exists); commission → charged = retail, commission =
--     round(retail × rate); none / walk-in → charged = retail.
--     Rounding is half-up on integer cents, per line, then summed.
--  4. Discount (amount or percent of the charged total) needs a reason and
--     is capped for receptionists by max_discount_percent_receptionist.
--  5. payer comes from the operator, walk-ins pay at reception.

-- ---------------------------------------------------------------------------
-- resolve_price_rule(): the rule in force for one thing on one date.
-- ---------------------------------------------------------------------------

create function public.resolve_price_rule(
  p_activity_id uuid,
  p_package_id uuid,
  p_participant_type public.participant_type,
  p_operator_id uuid,
  p_service_date date
)
returns public.price_rules
language sql
stable
security definer
set search_path = ''
as $$
  select r.*
  from public.price_rules r
  where r.activity_id is not distinct from p_activity_id
    and r.package_id is not distinct from p_package_id
    and r.participant_type = p_participant_type
    and r.effective_from <= p_service_date
    and (r.effective_to is null or r.effective_to > p_service_date)
    and (
      (r.audience = 'operator' and r.operator_id = p_operator_id)
      or r.audience = 'walk_in'
    )
  order by (r.audience = 'operator') desc
  limit 1;
$$;

revoke execute on function public.resolve_price_rule(uuid, uuid, public.participant_type, uuid, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- build_quote(input) → quote
--
-- input: {service_date, operator_id?, lines: [{target_type: 'package'|'activity',
--         target_id, participant_type, quantity}],
--         discount?: {type: 'amount'|'percent', value, reason}}
--         (amount value in cents; percent value in basis points, 1000 = 10%)
-- quote: {audience, operator_id, payer, lines: [...], retail_total_cents,
--         charged_total_cents, discount_total_cents, operator_net_total_cents,
--         commission_total_cents, warnings: [...]}
-- ---------------------------------------------------------------------------

create function public.build_quote(input jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_date date := nullif(input ->> 'service_date', '')::date;
  v_operator public.tour_operators;
  v_has_operator boolean := false;
  v_lines jsonb := coalesce(input -> 'lines', '[]'::jsonb);
  v_line jsonb;
  v_n int := 0;
  v_type public.participant_type;
  v_qty int;
  v_pkg public.packages;
  v_act public.activities;
  v_rule public.price_rules;
  v_pa record;
  v_name text;
  v_includes jsonb;
  v_unit_retail bigint;
  v_unit_charged bigint;
  v_unit_net bigint;
  v_has_net boolean;
  v_commission bigint;
  v_rate numeric;
  v_rates numeric[];
  v_rule_id uuid;
  v_out jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_charged_before bigint := 0;
  v_discount jsonb := input -> 'discount';
  v_discount_total bigint := 0;
  v_reason text;
  v_max_percent int;
  v_alloc bigint;
  v_remaining bigint;
  v_i int;
  v_totals record;
  v_type_label text;
  v_date_label text;
begin
  if not public.has_role(array['admin', 'receptionist', 'accountant']::public.app_role[]) then
    raise exception 'Only office staff can price bookings.';
  end if;
  if v_date is null then
    raise exception 'Choose the service date.';
  end if;
  v_date_label := to_char(v_date, 'FMDD Mon YYYY');

  if nullif(input ->> 'operator_id', '') is not null then
    select * into v_operator from public.tour_operators
    where id = (input ->> 'operator_id')::uuid and is_active;
    if not found then
      raise exception 'Choose an active tour operator.';
    end if;
    v_has_operator := true;
  end if;

  if jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 then
    raise exception 'Add at least one package or activity.';
  end if;

  for v_line in select * from jsonb_array_elements(v_lines) loop
    v_n := v_n + 1;
    begin
      v_type := (v_line ->> 'participant_type')::public.participant_type;
      v_qty := (v_line ->> 'quantity')::int;
    exception when others then
      raise exception 'Line % is not valid. Choose adult, child or infant and a whole number.', v_n;
    end;
    if v_type is null or v_qty is null or v_qty < 1 or v_qty > 500 then
      raise exception 'Line % needs a quantity between 1 and 500.', v_n;
    end if;
    v_type_label := v_type::text;
    v_unit_retail := 0; v_unit_charged := 0; v_unit_net := 0; v_has_net := false;
    v_commission := 0; v_rates := '{}'; v_rule_id := null; v_includes := '[]'::jsonb;

    if v_line ->> 'target_type' = 'package' then
      select * into v_pkg from public.packages where id = (v_line ->> 'target_id')::uuid;
      if not found then
        raise exception 'That package no longer exists. Reload the page.';
      end if;
      if not v_pkg.is_active then
        raise exception '% is no longer on sale.', v_pkg.name;
      end if;
      v_name := v_pkg.name;
      select coalesce(jsonb_agg(a.name order by pa.sort_order), '[]'::jsonb) into v_includes
      from public.package_activities pa join public.activities a on a.id = pa.activity_id
      where pa.package_id = v_pkg.id and not pa.is_optional;

      if v_pkg.pricing_mode = 'bundle' then
        v_rule := public.resolve_price_rule(null, v_pkg.id, v_type, v_operator.id, v_date);
        if v_rule.id is null then
          raise exception 'No price configured for % / % on %. Ask an admin to set it.', v_name, v_type_label, v_date_label;
        end if;
        v_rule_id := v_rule.id;
        -- settle one rule for the whole package
        v_unit_retail := v_rule.retail_cents;
        if not v_has_operator or v_operator.settlement_model = 'none' then
          v_unit_charged := v_rule.retail_cents;
        elsif v_operator.settlement_model = 'net_rate' then
          if v_rule.net_cents is null then
            v_unit_charged := v_rule.retail_cents;
            v_warnings := v_warnings || to_jsonb(format('No net price for %s / %s with %s: charged at retail.', v_name, v_type_label, v_operator.name));
          else
            v_unit_charged := v_rule.net_cents;
            v_unit_net := v_rule.net_cents;
            v_has_net := true;
          end if;
        else
          v_unit_charged := v_rule.retail_cents;
          v_rate := coalesce(v_rule.commission_rate, v_operator.default_commission_rate);
          v_rates := array_append(v_rates, v_rate);
          v_commission := round(v_rule.retail_cents * v_qty * v_rate);
        end if;
      else
        for v_pa in
          select pa.activity_id, pa.quantity_per_participant as qpp, a.name
          from public.package_activities pa join public.activities a on a.id = pa.activity_id
          where pa.package_id = v_pkg.id and not pa.is_optional
          order by pa.sort_order
        loop
          v_rule := public.resolve_price_rule(v_pa.activity_id, null, v_type, v_operator.id, v_date);
          if v_rule.id is null then
            raise exception 'No price configured for % / % on %. Ask an admin to set it.', v_pa.name, v_type_label, v_date_label;
          end if;
          v_unit_retail := v_unit_retail + v_rule.retail_cents * v_pa.qpp;
          if not v_has_operator or v_operator.settlement_model = 'none' then
            v_unit_charged := v_unit_charged + v_rule.retail_cents * v_pa.qpp;
          elsif v_operator.settlement_model = 'net_rate' then
            if v_rule.net_cents is null then
              v_unit_charged := v_unit_charged + v_rule.retail_cents * v_pa.qpp;
              v_warnings := v_warnings || to_jsonb(format('No net price for %s / %s with %s: charged at retail.', v_pa.name, v_type_label, v_operator.name));
            else
              v_unit_charged := v_unit_charged + v_rule.net_cents * v_pa.qpp;
              v_unit_net := v_unit_net + v_rule.net_cents * v_pa.qpp;
              v_has_net := true;
            end if;
          else
            v_unit_charged := v_unit_charged + v_rule.retail_cents * v_pa.qpp;
            v_rate := coalesce(v_rule.commission_rate, v_operator.default_commission_rate);
            v_rates := array_append(v_rates, v_rate);
            v_commission := v_commission + round(v_rule.retail_cents * v_pa.qpp * v_qty * v_rate);
          end if;
        end loop;
      end if;
      v_line := jsonb_build_object('line_type', 'package', 'package_id', v_pkg.id, 'activity_id', null);

    elsif v_line ->> 'target_type' = 'activity' then
      select * into v_act from public.activities where id = (v_line ->> 'target_id')::uuid;
      if not found then
        raise exception 'That activity no longer exists. Reload the page.';
      end if;
      if not v_act.is_active then
        raise exception '% is no longer on sale.', v_act.name;
      end if;
      v_name := v_act.name;
      v_includes := jsonb_build_array(v_act.name);
      v_rule := public.resolve_price_rule(v_act.id, null, v_type, v_operator.id, v_date);
      if v_rule.id is null then
        raise exception 'No price configured for % / % on %. Ask an admin to set it.', v_name, v_type_label, v_date_label;
      end if;
      v_rule_id := v_rule.id;
      v_unit_retail := v_rule.retail_cents;
      if not v_has_operator or v_operator.settlement_model = 'none' then
        v_unit_charged := v_rule.retail_cents;
      elsif v_operator.settlement_model = 'net_rate' then
        if v_rule.net_cents is null then
          v_unit_charged := v_rule.retail_cents;
          v_warnings := v_warnings || to_jsonb(format('No net price for %s / %s with %s: charged at retail.', v_name, v_type_label, v_operator.name));
        else
          v_unit_charged := v_rule.net_cents;
          v_unit_net := v_rule.net_cents;
          v_has_net := true;
        end if;
      else
        v_unit_charged := v_rule.retail_cents;
        v_rate := coalesce(v_rule.commission_rate, v_operator.default_commission_rate);
        v_rates := array_append(v_rates, v_rate);
        v_commission := round(v_rule.retail_cents * v_qty * v_rate);
      end if;
      v_line := jsonb_build_object('line_type', 'activity', 'package_id', null, 'activity_id', v_act.id);
    else
      raise exception 'Line % must be a package or an activity.', v_n;
    end if;

    v_charged_before := v_charged_before + v_unit_charged * v_qty;
    v_out := v_out || jsonb_build_array(v_line || jsonb_build_object(
      'name', v_name,
      'includes', v_includes,
      'participant_type', v_type,
      'quantity', v_qty,
      'unit_retail_cents', v_unit_retail,
      'unit_charged_cents', v_unit_charged,
      'unit_operator_net_cents', case when v_has_net then v_unit_net end,
      -- one rate per line when every component shares it; otherwise null
      'commission_rate', case when cardinality(v_rates) > 0
                              and (select count(distinct r) from unnest(v_rates) r) = 1 then v_rates[1] end,
      'commission_cents', v_commission,
      'discount_cents', 0,
      'discount_reason', null,
      'price_rule_id', v_rule_id,
      'sort_order', v_n * 10
    ));
  end loop;

  -- Discount: a total for the booking, spread over the lines in proportion to
  -- what each is charged (largest remainder), so the lines sum exactly.
  if v_discount is not null and jsonb_typeof(v_discount) = 'object' then
    v_reason := nullif(trim(v_discount ->> 'reason'), '');
    if (v_discount ->> 'value')::bigint is null or (v_discount ->> 'value')::bigint <= 0 then
      raise exception 'Enter the discount, or remove it.';
    end if;
    if v_reason is null then
      raise exception 'Give a reason for the discount.';
    end if;
    if v_discount ->> 'type' = 'amount' then
      v_discount_total := (v_discount ->> 'value')::bigint;
    elsif v_discount ->> 'type' = 'percent' then
      if (v_discount ->> 'value')::bigint > 10000 then
        raise exception 'A discount cannot be more than 100%%.';
      end if;
      v_discount_total := round(v_charged_before * (v_discount ->> 'value')::bigint / 10000.0);
    else
      raise exception 'Choose an amount or a percentage discount.';
    end if;
    if v_discount_total > v_charged_before then
      raise exception 'The discount is larger than the price.';
    end if;

    if public.auth_role() = 'receptionist' then
      select coalesce((select (value #>> '{}')::int from public.app_settings
                       where key = 'max_discount_percent_receptionist' and jsonb_typeof(value) = 'number'), 10)
        into v_max_percent;
      if v_discount_total * 100 > v_charged_before * v_max_percent then
        raise exception '%', format('Reception can give at most %s%% discount (Rs %s on this booking). Ask an admin for more.',
          v_max_percent, to_char(floor(v_charged_before * v_max_percent / 100.0 / 100), 'FM999,999,990'));
      end if;
    end if;

    if v_discount_total > 0 then
      v_remaining := v_discount_total;
      -- floor shares first
      for v_i in 0 .. jsonb_array_length(v_out) - 1 loop
        v_alloc := floor(v_discount_total * ((v_out -> v_i ->> 'unit_charged_cents')::bigint * (v_out -> v_i ->> 'quantity')::int)::numeric / v_charged_before);
        v_out := jsonb_set(v_out, array[v_i::text, 'discount_cents'], to_jsonb(v_alloc));
        v_remaining := v_remaining - v_alloc;
      end loop;
      -- then one cent each to the largest remainders
      for v_i in
        select (o - 1)::int
        from jsonb_array_elements(v_out) with ordinality as t(l, o)
        order by (v_discount_total * ((l ->> 'unit_charged_cents')::bigint * (l ->> 'quantity')::int)::numeric / v_charged_before)
                 - floor(v_discount_total * ((l ->> 'unit_charged_cents')::bigint * (l ->> 'quantity')::int)::numeric / v_charged_before) desc, o
        limit v_remaining
      loop
        v_out := jsonb_set(v_out, array[v_i::text, 'discount_cents'],
                           to_jsonb((v_out -> v_i ->> 'discount_cents')::bigint + 1));
      end loop;
      for v_i in 0 .. jsonb_array_length(v_out) - 1 loop
        if (v_out -> v_i ->> 'discount_cents')::bigint > 0 then
          v_out := jsonb_set(v_out, array[v_i::text, 'discount_reason'], to_jsonb(v_reason));
        end if;
      end loop;
    end if;
  end if;

  select
    sum((l ->> 'unit_retail_cents')::bigint * (l ->> 'quantity')::int) as retail,
    sum((l ->> 'unit_charged_cents')::bigint * (l ->> 'quantity')::int) - sum((l ->> 'discount_cents')::bigint) as charged,
    sum((l ->> 'discount_cents')::bigint) as discount,
    sum(coalesce((l ->> 'unit_operator_net_cents')::bigint, 0) * (l ->> 'quantity')::int) as net,
    sum((l ->> 'commission_cents')::bigint) as commission
  into v_totals
  from jsonb_array_elements(v_out) l;

  return jsonb_build_object(
    'service_date', v_date,
    'audience', case when v_has_operator then 'operator' else 'walk_in' end,
    'operator_id', v_operator.id,
    'operator_name', v_operator.name,
    'settlement_model', case when v_has_operator then v_operator.settlement_model else 'none' end,
    'payer', case when v_has_operator then v_operator.payer else 'client' end,
    'lines', v_out,
    'retail_total_cents', v_totals.retail,
    'charged_total_cents', v_totals.charged,
    'discount_total_cents', v_totals.discount,
    'operator_net_total_cents', v_totals.net,
    'commission_total_cents', v_totals.commission,
    'warnings', (select coalesce(jsonb_agg(distinct w), '[]'::jsonb) from jsonb_array_elements(v_warnings) w)
  );
end;
$$;

revoke execute on function public.build_quote(jsonb) from public, anon;
grant execute on function public.build_quote(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- create_booking(payload), replacing WP-06's version: the amounts now come
-- from build_quote(), never from the payload.
--
-- payload: {idempotency_key, client_id | client {first_name, last_name,
--   phone_e164?, email?, country?}, service_date, operator_id?, lines,
--   discount?, participants: [{participant_type, count}], departure_time?,
--   meeting_point?, notes?, resource_id?, payment? {amount_cents, method,
--   reference?, note?}, expected_total_cents}
-- expected_total_cents is the total the receptionist was shown; if the
-- engine now says otherwise the booking is refused, never silently changed.
-- ---------------------------------------------------------------------------

create or replace function public.create_booking(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := nullif(trim(payload ->> 'idempotency_key'), '');
  v_existing public.bookings;
  v_quote jsonb;
  v_client_id uuid;
  v_service_date date;
  v_resource_id uuid := nullif(payload ->> 'resource_id', '')::uuid;
  v_notes text := nullif(trim(payload ->> 'notes'), '');
  v_payment jsonb := payload -> 'payment';
  v_booking_id uuid;
  v_reference text;
  v_item jsonb;
  v_item_id uuid;
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

  -- Price everything here, from price_rules.
  v_quote := public.build_quote(payload);
  v_service_date := (v_quote ->> 'service_date')::date;

  if (payload ->> 'expected_total_cents') is null
    or (payload ->> 'expected_total_cents')::bigint is distinct from (v_quote ->> 'charged_total_cents')::bigint then
    raise exception 'Prices changed while you were booking. Please review the total and submit again.';
  end if;

  if jsonb_typeof(payload -> 'participants') is distinct from 'array'
    or not exists (select 1 from jsonb_array_elements(payload -> 'participants') p where (p ->> 'count')::int > 0) then
    raise exception 'Add at least one participant.';
  end if;

  -- Fleet: anything that includes the catamaran needs a boat (capacity is
  -- warned about in the form, not enforced).
  select exists (
    select 1
    from jsonb_array_elements(v_quote -> 'lines') l
    left join public.package_activities pa
      on pa.package_id = (l ->> 'package_id')::uuid and not pa.is_optional
    join public.activities a on a.id = coalesce(pa.activity_id, (l ->> 'activity_id')::uuid)
    where a.code = 'CATAMARAN'
  ) into v_needs_boat;
  if v_needs_boat and v_resource_id is null then
    raise exception 'Assign a boat: this booking includes the catamaran.';
  end if;
  if v_resource_id is not null and not exists (select 1 from public.resources where id = v_resource_id and is_active) then
    raise exception 'The chosen boat is not available. Pick another.';
  end if;

  if v_payment is not null and jsonb_typeof(v_payment) = 'object' then
    if v_quote ->> 'payer' = 'operator' then
      raise exception 'Do not collect payment: % pays for this booking on account.', v_quote ->> 'operator_name';
    end if;
    if coalesce((v_payment ->> 'amount_cents')::bigint, 0) <= 0 then
      raise exception 'Enter the amount received, or leave the payment out.';
    end if;
    if (v_payment ->> 'amount_cents')::bigint > (v_quote ->> 'charged_total_cents')::bigint then
      raise exception 'The payment is more than the booking total. Record only what pays for the booking; give the rest back as change.';
    end if;
  else
    v_payment := null;
  end if;

  -- Client: existing, or new.
  if nullif(payload ->> 'client_id', '') is not null then
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
      v_reference, v_client_id, v_quote ->> 'audience', nullif(v_quote ->> 'operator_id', '')::uuid, v_resource_id,
      v_service_date, nullif(payload ->> 'departure_time', '')::time, nullif(trim(payload ->> 'meeting_point'), ''),
      (v_quote ->> 'retail_total_cents')::bigint, (v_quote ->> 'charged_total_cents')::bigint,
      (v_quote ->> 'discount_total_cents')::bigint, (v_quote ->> 'operator_net_total_cents')::bigint,
      (v_quote ->> 'commission_total_cents')::bigint,
      v_quote ->> 'payer', v_notes, v_key, auth.uid()
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

  for v_item in select * from jsonb_array_elements(v_quote -> 'lines') loop
    insert into public.booking_items (
      booking_id, line_type, package_id, activity_id, participant_type, quantity,
      unit_retail_cents, unit_charged_cents, unit_operator_net_cents, commission_rate, commission_cents,
      discount_cents, discount_reason, price_rule_id, sort_order
    ) values (
      v_booking_id, v_item ->> 'line_type', (v_item ->> 'package_id')::uuid, (v_item ->> 'activity_id')::uuid,
      (v_item ->> 'participant_type')::public.participant_type, (v_item ->> 'quantity')::int,
      (v_item ->> 'unit_retail_cents')::bigint, (v_item ->> 'unit_charged_cents')::bigint,
      (v_item ->> 'unit_operator_net_cents')::bigint, (v_item ->> 'commission_rate')::numeric,
      (v_item ->> 'commission_cents')::bigint, (v_item ->> 'discount_cents')::bigint,
      v_item ->> 'discount_reason', (v_item ->> 'price_rule_id')::uuid, (v_item ->> 'sort_order')::int
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
        raise exception '% has no activities configured. Ask an admin to fix it.', v_item ->> 'name';
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

  return jsonb_build_object(
    'booking_id', v_booking_id,
    'reference', v_reference,
    'created', true,
    'charged_total_cents', (v_quote ->> 'charged_total_cents')::bigint
  );
end;
$$;

comment on function public.create_booking(jsonb) is
  'Creates a booking atomically. Every amount comes from build_quote(); the payload carries only choices and the total the user was shown.';
