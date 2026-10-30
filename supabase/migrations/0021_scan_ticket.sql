-- WP-24 (V2): scan_ticket(), the narrow read path for island staff. It is the
-- only way activity_staff and activity_supervisor see a booking at all.
--
-- The payload is built from explicitly named columns, never from a row with
-- keys removed afterwards: a security definer function that selects
-- bookings.* and deletes fields leaks the day someone adds a column. It
-- carries no price, total, commission, operator, phone, email, full client
-- name, payment status or note; tests/rls/scan.test.ts scans the serialised
-- output for those words so a future addition fails a test rather than leaking.

create function public.scan_ticket(
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

  -- The order is the V2 plan's (WP-24 step 2): the first that applies wins.
  v_verdict := case
    when v_revoked then 'REVOKED'
    when v_status = 'cancelled' then 'CANCELLED'
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

revoke execute on function public.scan_ticket(text, uuid, text) from public, anon;
grant execute on function public.scan_ticket(text, uuid, text) to authenticated;
