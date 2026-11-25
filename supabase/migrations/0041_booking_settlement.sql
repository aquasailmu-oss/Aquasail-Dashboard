-- Existing bookings retain their historical pricing and settlement figures.
alter table public.bookings
  add column if not exists tracks_settlement boolean not null default false,
  add column if not exists agency_adjustment_status text not null default 'none',
  add column if not exists agency_adjustment_cents bigint,
  add column if not exists agency_adjustment_reason text,
  drop constraint if exists booking_agency_adjustment_check,
  add constraint booking_agency_adjustment_check check (
    (agency_adjustment_status in ('none', 'pending') and agency_adjustment_cents is null and agency_adjustment_reason is null)
    or (agency_adjustment_status = 'recorded' and agency_adjustment_cents is not null
        and agency_adjustment_cents <> 0 and nullif(trim(agency_adjustment_reason), '') is not null)
  );
alter table public.bookings alter column tracks_settlement set default true;

alter table public.booking_items
  add column if not exists settlement_manual boolean not null default false,
  add column if not exists settlement_aquasail_cents bigint,
  drop constraint if exists booking_item_manual_share_check,
  add constraint booking_item_manual_share_check check (
    settlement_aquasail_cents is null or
    (settlement_manual and settlement_aquasail_cents between 0 and unit_charged_cents * quantity - discount_cents)
  );

create or replace function public.flag_manual_booking_split() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (
    select 1 from public.bookings b join public.tour_operators o on o.id = b.operator_id
    left join public.activities a on a.id = new.activity_id
    left join public.packages p on p.id = new.package_id
    where b.id = new.booking_id and b.tracks_settlement and (
      a.code ~* '^PARASAIL' or a.name ~* 'parasail|cata[ -]?speed'
      or a.code ~* 'CATASPEED'
      or p.code ~* 'CATASPEED|^PARASAIL(_(SINGLE|DOUBLE))?$'
      or p.name ~* 'cata[ -]?speed|^parasailing[ -]*(single|double)$'
      or (o.name ~* 'silver[ -]?wings' and (a.name ~* 'waterfall' or a.code ~* 'WFALL|WATERFALL'))
    )
  ) then
    new.settlement_manual := true;
  end if;
  return new;
end;
$$;
create or replace trigger flag_manual_booking_split before insert on public.booking_items
for each row execute function public.flag_manual_booking_split();

create or replace function public.reopen_changed_booking_split() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.settlement_manual and
     (new.quantity, new.unit_charged_cents, new.discount_cents) is distinct from
     (old.quantity, old.unit_charged_cents, old.discount_cents) then
    new.settlement_aquasail_cents := null;
  end if;
  return new;
end;
$$;
create or replace trigger reopen_changed_booking_split
before update of quantity, unit_charged_cents, discount_cents on public.booking_items
for each row execute function public.reopen_changed_booking_split();

-- Preserve historical reductions when attendance is edited and prohibit new ones.
create or replace function public.freeze_attendance_reductions() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.prebook_reduction_cents <> 0 then raise exception 'Record adjustments in Booking settlement.'; end if;
  elsif new.prebook_reduction_cents <> 0 and new.prebook_reduction_cents is distinct from old.prebook_reduction_cents then
    raise exception 'Record adjustments in Booking settlement.';
  else
    new.prebook_reduction_cents := old.prebook_reduction_cents;
    new.prebook_reduction_reason := old.prebook_reduction_reason;
  end if;
  return new;
end;
$$;
create or replace trigger freeze_attendance_reductions before insert or update on public.booking_attendance
for each row execute function public.freeze_attendance_reductions();

create or replace function public.save_booking_settlement(
  p_booking_id uuid, p_item_id uuid, p_manual boolean, p_aquasail bigint,
  p_adjustment_status text, p_adjustment_cents bigint, p_reason text
) returns void language plpgsql security definer set search_path = '' as $$
declare b public.bookings;
begin
  if not public.has_role(array['admin', 'receptionist']::public.app_role[]) then
    raise exception 'Only reception or an admin can record settlement.';
  end if;
  select * into b from public.bookings where id = p_booking_id for update;
  if not found or b.operator_id is null or b.status = 'cancelled' then
    raise exception 'Choose an active operator booking.';
  end if;
  if p_item_id is not null then
    if not b.tracks_settlement then raise exception 'This booking uses historical settlement figures.'; end if;
    update public.booking_items set settlement_manual = p_manual, settlement_aquasail_cents = p_aquasail
    where id = p_item_id and booking_id = b.id;
    if not found then raise exception 'This booking line has changed. Refresh and try again.'; end if;
  else
    if b.payer <> 'operator' then raise exception 'Choose a pre-book to record an agency adjustment.'; end if;
    update public.bookings set agency_adjustment_status = p_adjustment_status,
      agency_adjustment_cents = p_adjustment_cents, agency_adjustment_reason = p_reason
    where id = b.id;
  end if;
end;
$$;
revoke all on function public.save_booking_settlement(uuid, uuid, boolean, bigint, text, bigint, text) from public, anon;
grant execute on function public.save_booking_settlement(uuid, uuid, boolean, bigint, text, bigint, text) to authenticated;

create or replace view public.booking_settlement_queue with (security_invoker = true) as
select b.id, b.reference, b.service_date, o.name as operator_name,
       b.agency_adjustment_status = 'pending' as adjustment_pending,
       s.pending_splits
from public.bookings b
join public.tour_operators o on o.id = b.operator_id
cross join lateral (
  select count(*)::int as pending_splits
  from public.booking_items i where i.booking_id = b.id and b.tracks_settlement
    and i.settlement_manual and i.settlement_aquasail_cents is null
) s
where b.status <> 'cancelled' and (b.agency_adjustment_status = 'pending' or s.pending_splits > 0);
grant select on public.booking_settlement_queue to authenticated;

create or replace function public.create_booking_with_hotel(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_booking_id uuid;
  v_hotel_name text := nullif(trim(payload ->> 'hotel_name'), '');
  v_attendance jsonb := payload -> 'attendance';
begin
  if not public.has_role(array['admin', 'receptionist']::public.app_role[]) then
    raise exception 'Only reception or an admin can create bookings.';
  end if;
  if char_length(v_hotel_name) > 120 then
    raise exception 'Keep the hotel name under 120 characters.';
  end if;

  v_result := public.create_booking(payload - 'hotel_name' - 'attendance' - 'adjustment_pending');
  v_booking_id := (v_result ->> 'booking_id')::uuid;

  update public.bookings
  set hotel_name = v_hotel_name
  where id = v_booking_id
    and hotel_name is distinct from v_hotel_name;

  if v_attendance is not null then
    if jsonb_typeof(v_attendance) <> 'object'
       or not (v_attendance ?& array[
         'adults_present', 'children_present', 'infants_present', 'prebook_reduction_cents'
       ]) then
      raise exception 'Attendance details are incomplete.';
    end if;
    perform public.record_booking_attendance(
      v_booking_id,
      (v_attendance ->> 'adults_present')::integer,
      (v_attendance ->> 'children_present')::integer,
      (v_attendance ->> 'infants_present')::integer,
      (v_attendance ->> 'prebook_reduction_cents')::bigint,
      nullif(v_attendance ->> 'prebook_reduction_reason', '')
    );
  end if;

  if (v_result ->> 'created')::boolean and payload -> 'adjustment_pending' = 'true'::jsonb then
    update public.bookings set agency_adjustment_status = 'pending'
    where id = v_booking_id and payer = 'operator';
  end if;

  return v_result;
end;
$$;

notify pgrst, 'reload schema';
