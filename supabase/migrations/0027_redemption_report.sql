-- WP-35 (V2): redemption reporting function. Returns aggregated data for
-- a date range, so the report page and Excel export share one source of truth.

create function public.redemption_report(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.app_role := public.auth_role();
  v_by_activity jsonb;
  v_by_location jsonb;
  v_by_device jsonb;
  v_by_staff jsonb;
  v_flagged jsonb;
begin
  if v_role is null or v_role not in ('admin', 'accountant') then
    raise exception 'Your role cannot view redemption reports.';
  end if;

  -- Per activity: entitled, redeemed, outstanding, rate
  select coalesce(jsonb_agg(row_data order by row_data->>'activity_name'), '[]'::jsonb)
  into v_by_activity
  from (
    select jsonb_build_object(
      'activity_name', a.name,
      'entitled', sum(ba.quantity),
      'redeemed', coalesce(sum(tr_sum.total_redeemed), 0),
      'outstanding', sum(ba.quantity) - coalesce(sum(tr_sum.total_redeemed), 0)
    ) as row_data
    from public.booking_activities ba
    join public.activities a on a.id = ba.activity_id
    join public.bookings b on b.id = ba.booking_id
    left join lateral (
      select sum(tr.quantity_redeemed) as total_redeemed
      from public.ticket_redemptions tr
      where tr.booking_activity_id = ba.id and not tr.is_reversal
    ) tr_sum on true
    where b.service_date between p_from and p_to
      and b.status != 'cancelled'
    group by a.name
  ) sub;

  -- Per location
  select coalesce(jsonb_agg(row_data order by row_data->>'location_name'), '[]'::jsonb)
  into v_by_location
  from (
    select jsonb_build_object(
      'location_name', coalesce(l.name, 'Unknown'),
      'total_redeemed', sum(tr.quantity_redeemed)
    ) as row_data
    from public.ticket_redemptions tr
    join public.booking_activities ba on ba.id = tr.booking_activity_id
    join public.bookings b on b.id = ba.booking_id
    left join public.locations l on l.id = tr.location_id
    where b.service_date between p_from and p_to
      and not tr.is_reversal
    group by l.name
  ) sub;

  -- Per device
  select coalesce(jsonb_agg(row_data order by row_data->>'device_label'), '[]'::jsonb)
  into v_by_device
  from (
    select jsonb_build_object(
      'device_label', coalesce(d.label, 'No device'),
      'total_redeemed', sum(tr.quantity_redeemed)
    ) as row_data
    from public.ticket_redemptions tr
    join public.booking_activities ba on ba.id = tr.booking_activity_id
    join public.bookings b on b.id = ba.booking_id
    left join public.staff_devices d on d.id = tr.device_id
    where b.service_date between p_from and p_to
      and not tr.is_reversal
    group by d.label
  ) sub;

  -- Per staff member
  select coalesce(jsonb_agg(row_data order by row_data->>'staff_name'), '[]'::jsonb)
  into v_by_staff
  from (
    select jsonb_build_object(
      'staff_name', coalesce(p.full_name, 'Unknown'),
      'total_redeemed', sum(tr.quantity_redeemed)
    ) as row_data
    from public.ticket_redemptions tr
    join public.booking_activities ba on ba.id = tr.booking_activity_id
    join public.bookings b on b.id = ba.booking_id
    left join public.profiles p on p.id = tr.redeemed_by
    where b.service_date between p_from and p_to
      and not tr.is_reversal
    group by p.full_name
  ) sub;

  -- Flagged: over-redemptions and provisionals with resolution
  select coalesce(jsonb_agg(row_data order by row_data->>'redeemed_at'), '[]'::jsonb)
  into v_flagged
  from (
    select jsonb_build_object(
      'redemption_id', tr.id,
      'reference', b.reference,
      'activity_name', a.name,
      'quantity_redeemed', tr.quantity_redeemed,
      'is_over_redemption', tr.is_over_redemption,
      'is_provisional', tr.is_provisional,
      'redeemed_at', tr.redeemed_at,
      'redeemed_by', coalesce(p.full_name, 'Unknown'),
      'reviewed_at', tr.reviewed_at,
      'review_note', tr.review_note,
      'reviewed_by', (select p2.full_name from public.profiles p2 where p2.id = tr.reviewed_by)
    ) as row_data
    from public.ticket_redemptions tr
    join public.booking_activities ba on ba.id = tr.booking_activity_id
    join public.activities a on a.id = ba.activity_id
    join public.bookings b on b.id = ba.booking_id
    left join public.profiles p on p.id = tr.redeemed_by
    where b.service_date between p_from and p_to
      and (tr.is_over_redemption or tr.is_provisional)
      and not tr.is_reversal
  ) sub;

  return jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'by_activity', v_by_activity,
    'by_location', v_by_location,
    'by_device', v_by_device,
    'by_staff', v_by_staff,
    'flagged', v_flagged
  );
end;
$$;

revoke execute on function public.redemption_report(date, date) from public, anon;
grant execute on function public.redemption_report(date, date) to authenticated;
