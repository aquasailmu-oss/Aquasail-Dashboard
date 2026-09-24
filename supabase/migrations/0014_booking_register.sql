-- WP-17: one row per booking with the figures every list needs (people,
-- paid, balance, payment status, what was booked). The Today screen, the
-- booking register and the Excel export all read this, so their totals tie.
-- security_invoker: the caller's RLS on bookings and related tables applies.

create view public.booking_register
with (security_invoker = true) as
select
  b.id,
  b.reference,
  regexp_replace(b.reference, '\D', '', 'g') as reference_digits,
  b.service_date,
  b.departure_time,
  b.status,
  b.source_type,
  b.operator_id,
  o.name as operator_name,
  b.payer,
  b.client_id,
  trim(c.first_name || ' ' || c.last_name) as client_name,
  c.phone_e164 as client_phone,
  b.resource_id,
  b.retail_total_cents,
  b.charged_total_cents,
  b.discount_total_cents,
  b.operator_net_total_cents,
  b.commission_total_cents,
  b.created_by,
  b.created_at,
  coalesce(pp.people, 0)::int as people,
  coalesce(pay.paid, 0)::bigint as paid_cents,
  (b.charged_total_cents - coalesce(pay.paid, 0))::bigint as balance_cents,
  case
    when b.payer = 'operator' then 'operator_account'
    when coalesce(pay.paid, 0) >= b.charged_total_cents then 'paid'
    when coalesce(pay.paid, 0) > 0 then 'part_paid'
    else 'unpaid'
  end as payment_status,
  coalesce(items.summary, '') as summary,
  coalesce(items.package_ids, '{}') as package_ids,
  coalesce(acts.activity_ids, '{}') as activity_ids
from public.bookings b
join public.clients c on c.id = b.client_id
left join public.tour_operators o on o.id = b.operator_id
left join lateral (
  select sum(count) as people from public.booking_participants where booking_id = b.id
) pp on true
left join lateral (
  select sum(amount_cents) as paid from public.payments where booking_id = b.id
) pay on true
left join lateral (
  select string_agg(distinct coalesce(pk.name, a.name), ', ') as summary,
         array_remove(array_agg(distinct i.package_id), null) as package_ids
  from public.booking_items i
  left join public.packages pk on pk.id = i.package_id
  left join public.activities a on a.id = i.activity_id
  where i.booking_id = b.id
) items on true
left join lateral (
  select array_agg(distinct ba.activity_id) as activity_ids from public.booking_activities ba where ba.booking_id = b.id
) acts on true;

revoke all on public.booking_register from anon;
grant select on public.booking_register to authenticated;
