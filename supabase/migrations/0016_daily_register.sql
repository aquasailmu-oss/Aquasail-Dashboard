-- WP-17b: the daily register (CLAUDE.md adjustment), as a database function
-- so V3's reconciliation reuses the same arithmetic.
--
-- For one service date, non-cancelled bookings only (except the grand total):
--  * Boat rows: a booking with a boat attributes its full value to that
--    vessel, counted as far as it is paid: min(paid, charged).
--  * Activity rows (every active activity except the catamaran, which the
--    boat rows cover), from bookings WITHOUT a boat: each entitlement is
--    valued at the activity's own resolved price for that date and source
--    (net for a net-rate operator when set, else retail) × quantity, scaled by
--    the booking's discount ratio (charged / pre-discount) and paid ratio
--    (min(1, paid / charged)). Rounded to the cent per row.
--  * Operator rows: people and everything paid on that operator's bookings.
--  * Total received: every payment on that date's bookings, all methods,
--    cancelled bookings included (their refunds are negative corrections).
-- Follows the prototype's viewRegister().

create function public.daily_register(p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb := '[]'::jsonb;
  v_ops jsonb := '[]'::jsonb;
  v_total bigint;
begin
  if not public.has_role(array['admin', 'accountant', 'receptionist']::public.app_role[]) then
    raise exception 'Only office staff can see the daily register.';
  end if;

  with bk as (
    select b.id, b.resource_id, b.operator_id, b.charged_total_cents as charged,
           coalesce((select sum(amount_cents) from public.payments p where p.booking_id = b.id), 0) as paid,
           coalesce((select sum(count) from public.booking_participants pp where pp.booking_id = b.id), 0) as people,
           coalesce((select sum(unit_charged_cents * quantity) from public.booking_items i where i.booking_id = b.id), 0) as pre_discount
    from public.bookings b
    where b.service_date = p_date and b.status <> 'cancelled'
  )
  select coalesce(jsonb_agg(x.row order by x.kind, x.sort_order, x.label), '[]'::jsonb) into v_rows
  from (
    -- Boats
    select 0 as kind, r.sort_order, r.name as label,
           jsonb_build_object('kind', 'boat', 'label', r.name,
             'pax', coalesce(sum(bk.people), 0)::int,
             'amount_cents', coalesce(sum(least(greatest(bk.paid, 0), bk.charged)), 0)::bigint) as row
    from public.resources r
    left join bk on bk.resource_id = r.id
    where r.is_active
    group by r.id, r.sort_order, r.name
    union all
    -- Activities from bookings without a boat
    select 1, a.sort_order, a.name,
           jsonb_build_object('kind', 'activity', 'label', a.name,
             'pax', coalesce(sum(v.qty), 0)::int,
             'amount_cents', coalesce(round(sum(v.value)), 0)::bigint)
    from public.activities a
    left join lateral (
      select ba.quantity as qty,
             ba.quantity
               * coalesce(case when o.settlement_model = 'net_rate' then coalesce(r.net_cents, r.retail_cents) else r.retail_cents end, 0)
               * case when bk.pre_discount > 0 then bk.charged::numeric / bk.pre_discount else 1 end
               * case when bk.charged > 0 then least(1, greatest(bk.paid, 0)::numeric / bk.charged) else 0 end as value
      from bk
      join public.booking_activities ba on ba.booking_id = bk.id and ba.activity_id = a.id
      join public.booking_items i on i.id = ba.source_item_id
      left join public.tour_operators o on o.id = bk.operator_id
      left join lateral (
        select * from public.resolve_price_rule(a.id, null, i.participant_type, bk.operator_id, p_date)
      ) r on true
      where bk.resource_id is null
    ) v on true
    where a.is_active and a.code <> 'CATAMARAN'
    group by a.id, a.sort_order, a.name
  ) x;

  with bk as (
    select b.operator_id,
           coalesce((select sum(amount_cents) from public.payments p where p.booking_id = b.id), 0) as paid,
           coalesce((select sum(count) from public.booking_participants pp where pp.booking_id = b.id), 0) as people
    from public.bookings b
    where b.service_date = p_date and b.status <> 'cancelled' and b.operator_id is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'label', o.name, 'settlement_model', o.settlement_model, 'commission_rate', o.default_commission_rate,
           'pax', coalesce(s.people, 0)::int, 'amount_cents', coalesce(s.paid, 0)::bigint) order by o.name), '[]'::jsonb)
    into v_ops
  from public.tour_operators o
  left join (select operator_id, sum(people) as people, sum(paid) as paid from bk group by operator_id) s on s.operator_id = o.id
  where o.is_active or s.operator_id is not null;

  select coalesce(sum(p.amount_cents), 0) into v_total
  from public.payments p join public.bookings b on b.id = p.booking_id
  where b.service_date = p_date;

  return jsonb_build_object(
    'date', p_date,
    'rows', v_rows,
    'subtotal_pax', (select coalesce(sum((r ->> 'pax')::int), 0) from jsonb_array_elements(v_rows) r),
    'subtotal_cents', (select coalesce(sum((r ->> 'amount_cents')::bigint), 0) from jsonb_array_elements(v_rows) r),
    'operators', v_ops,
    'total_received_cents', v_total
  );
end;
$$;

revoke execute on function public.daily_register(date) from public, anon;
grant execute on function public.daily_register(date) to authenticated;
