-- WP-26 (V2): the ticket lifecycle. A booking has exactly one live ticket;
-- reissuing (a lost phone) creates a new one and revokes the old in the same
-- transaction; cancelling a booking revokes its ticket. A revoked token is
-- never deleted, so scanning it explains itself instead of "not found".

alter table public.tickets drop constraint tickets_booking_id_key;
create unique index tickets_one_live_per_booking_idx on public.tickets (booking_id) where revoked_at is null;
create index tickets_booking_idx on public.tickets (booking_id);

-- Revocation itself. Internal: reissue_ticket() and the cancellation trigger
-- call it; a ticket is never revoked on its own, which would leave a booking
-- with nothing that scans.
create function public.revoke_ticket(p_ticket_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(trim(p_reason), '') is null then
    raise exception 'Give a reason for replacing this ticket.';
  end if;
  update public.tickets
  set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = trim(p_reason)
  where id = p_ticket_id and revoked_at is null;
end;
$$;

revoke execute on function public.revoke_ticket(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- reissue_ticket(): a new token for the booking; the previous one stops
-- working at once. Reception or an admin, with a reason.
-- ---------------------------------------------------------------------------

create function public.reissue_ticket(p_booking_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_old public.tickets;
  v_new public.tickets;
begin
  if public.auth_role() is null or public.auth_role() not in ('admin', 'receptionist') then
    raise exception 'Only reception or an admin can reissue a ticket.';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'Give a reason for reissuing the ticket.';
  end if;
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'That booking does not exist.';
  end if;
  if v_booking.status = 'cancelled' then
    raise exception 'This booking is cancelled, so its ticket cannot be reissued.';
  end if;

  select * into v_old from public.tickets
  where booking_id = p_booking_id
  order by (revoked_at is null) desc, issued_at desc
  limit 1;
  if v_old.id is not null then
    perform public.revoke_ticket(v_old.id, p_reason);
  end if;

  insert into public.tickets (booking_id, reissued_from_ticket_id)
  values (p_booking_id, v_old.id)
  returning * into v_new;

  return jsonb_build_object('ticket_id', v_new.id, 'token', v_new.token, 'replaced_ticket_id', v_old.id);
end;
$$;

revoke execute on function public.reissue_ticket(uuid, text) from public, anon;
grant execute on function public.reissue_ticket(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Cancelling a booking revokes its ticket, whichever path cancels it.
-- Without this a cancelled booking would scan as valid: the most obvious
-- fraud path in the system.
-- ---------------------------------------------------------------------------

create function public.revoke_ticket_on_cancel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket_id uuid;
begin
  for v_ticket_id in select id from public.tickets where booking_id = new.id and revoked_at is null loop
    perform public.revoke_ticket(v_ticket_id, 'Booking cancelled: ' || new.cancellation_reason);
  end loop;
  return null;
end;
$$;

revoke execute on function public.revoke_ticket_on_cancel() from public, anon, authenticated;

create trigger bookings_revoke_ticket_on_cancel
  after update of status on public.bookings
  for each row
  when (new.status = 'cancelled' and old.status is distinct from 'cancelled')
  execute function public.revoke_ticket_on_cancel();

-- Tickets of bookings cancelled before this migration.
update public.tickets t
set revoked_at = b.cancelled_at, revoked_by = b.cancelled_by, revoke_reason = 'Booking cancelled: ' || b.cancellation_reason
from public.bookings b
where b.id = t.booking_id and b.status = 'cancelled' and t.revoked_at is null;

-- ---------------------------------------------------------------------------
-- scan_ticket(): CANCELLED before REVOKED (see the comment inside).
-- ---------------------------------------------------------------------------

create or replace function public.scan_ticket(
  p_token text,
  p_device_id uuid default null,
  p_device_secret text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket_id uuid;
  v_booking_id uuid;
  v_revoked boolean;
  v_status public.booking_status;
  v_service_date date;
  v_entitlements jsonb;
  v_verdict text;
begin
  if public.auth_role() is null
     or public.auth_role() not in ('admin', 'receptionist', 'activity_supervisor', 'activity_staff') then
    raise exception 'Your role cannot scan tickets.';
  end if;
  perform public.verified_device(p_device_id, p_device_secret);

  select t.id, t.booking_id, t.revoked_at is not null, b.status, b.service_date
  into v_ticket_id, v_booking_id, v_revoked, v_status, v_service_date
  from public.tickets t
  join public.bookings b on b.id = t.booking_id
  where t.token = trim(p_token);

  if v_ticket_id is null then
    return jsonb_build_object('verdict', 'NOT_FOUND');
  end if;

  v_entitlements := public.booking_entitlements(v_booking_id);

  -- The first that applies wins. CANCELLED comes before REVOKED (the plan's
  -- WP-24 order has them the other way round): cancelling now revokes the
  -- ticket, and staff must still see CANCELLED for it (V2 definition of
  -- done 6). REVOKED is left for a ticket replaced by a newer one.
  v_verdict := case
    when v_status = 'cancelled' then 'CANCELLED'
    when v_revoked then 'REVOKED'
    when v_service_date <> public.today_mauritius() then 'WRONG_DATE'
    when jsonb_array_length(v_entitlements) > 0
      and not exists (select 1 from jsonb_array_elements(v_entitlements) e where (e ->> 'remaining')::int > 0)
      then 'ALREADY_REDEEMED'
    when exists (select 1 from jsonb_array_elements(v_entitlements) e where (e ->> 'redeemed')::int > 0)
      then 'PARTLY_USED'
    else 'VALID'
  end;

  return (
    select jsonb_build_object(
      'verdict', v_verdict,
      'booking_id', b.id,
      'reference', b.reference,
      'client_surname', c.last_name,
      'client_first_initial', left(c.first_name, 1),
      'adults', coalesce((select bp.count from public.booking_participants bp
                          where bp.booking_id = b.id and bp.participant_type = 'adult'), 0),
      'children', coalesce((select bp.count from public.booking_participants bp
                            where bp.booking_id = b.id and bp.participant_type = 'child'), 0),
      'infants', coalesce((select bp.count from public.booking_participants bp
                           where bp.booking_id = b.id and bp.participant_type = 'infant'), 0),
      'service_date', b.service_date,
      'departure_time', b.departure_time,
      'meeting_point', b.meeting_point,
      'checked_in_at', b.checked_in_at,
      'checked_in_by_name', (select p.full_name from public.profiles p where p.id = b.checked_in_by),
      'entitlements', v_entitlements,
      -- Active activities this booking does not include, so "is parasailing
      -- included?" gets an answer rather than a silence.
      'not_included', (
        select coalesce(jsonb_agg(jsonb_build_object('activity_code', a.code, 'activity_name', a.name)
                                  order by a.sort_order, a.name), '[]'::jsonb)
        from public.activities a
        where a.is_active and a.is_redeemable
          and not exists (select 1 from public.booking_activities ba where ba.booking_id = b.id and ba.activity_id = a.id)
      )
    )
    from public.bookings b
    join public.clients c on c.id = b.client_id
    where b.id = v_booking_id
  );
end;
$$;
