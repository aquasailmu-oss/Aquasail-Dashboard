-- Record the referring hotel on each booking. A client's hotel can differ
-- between visits, so this belongs to the booking rather than the client.
alter table public.bookings
  add column hotel_name text,
  add constraint bookings_hotel_name_length check (hotel_name is null or char_length(hotel_name) <= 120);

-- Keep hotel capture in the same transaction as booking creation. The core
-- writer remains the source of truth for pricing, participants and payment.
create function public.create_booking_with_hotel(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_booking_id uuid;
  v_hotel_name text := nullif(trim(payload ->> 'hotel_name'), '');
begin
  if not public.has_role(array['admin', 'receptionist']::public.app_role[]) then
    raise exception 'Only reception or an admin can create bookings.';
  end if;
  if char_length(v_hotel_name) > 120 then
    raise exception 'Keep the hotel name under 120 characters.';
  end if;

  v_result := public.create_booking(payload - 'hotel_name');
  v_booking_id := (v_result ->> 'booking_id')::uuid;

  update public.bookings
  set hotel_name = v_hotel_name
  where id = v_booking_id
    and hotel_name is distinct from v_hotel_name;

  return v_result;
end;
$$;

-- Hotel is editable along with the rest of the booking's operational details.
create function public.amend_booking_with_hotel(p_booking_id uuid, payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_hotel_name text := nullif(trim(payload ->> 'hotel_name'), '');
begin
  if not public.has_role(array['admin', 'receptionist']::public.app_role[]) then
    raise exception 'Only reception or an admin can amend bookings.';
  end if;
  if char_length(v_hotel_name) > 120 then
    raise exception 'Keep the hotel name under 120 characters.';
  end if;

  v_result := public.amend_booking(p_booking_id, payload - 'hotel_name');

  update public.bookings
  set hotel_name = v_hotel_name
  where id = p_booking_id
    and hotel_name is distinct from v_hotel_name;

  return v_result;
end;
$$;

revoke all on function public.create_booking_with_hotel(jsonb) from public, anon;
revoke all on function public.amend_booking_with_hotel(uuid, jsonb) from public, anon;
grant execute on function public.create_booking_with_hotel(jsonb) to authenticated;
grant execute on function public.amend_booking_with_hotel(uuid, jsonb) to authenticated;

-- Keep the register/export view stable and append the new nullable column.
create or replace view public.booking_register
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
  coalesce(acts.activity_ids, '{}') as activity_ids,
  b.hotel_name
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
