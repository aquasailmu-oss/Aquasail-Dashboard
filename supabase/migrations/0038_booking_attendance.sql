-- Attendance is recorded separately from the original booking counts and
-- price snapshots. Pre-book reductions are explicit manual adjustments.
create table public.booking_attendance (
  booking_id uuid primary key references public.bookings (id) on delete cascade,
  adults_expected_count integer not null check (adults_expected_count >= 0),
  adults_present_count integer not null check (adults_present_count >= 0 and adults_present_count <= adults_expected_count),
  children_expected_count integer not null check (children_expected_count >= 0),
  children_present_count integer not null check (children_present_count >= 0 and children_present_count <= children_expected_count),
  infants_expected_count integer not null check (infants_expected_count >= 0),
  infants_present_count integer not null check (infants_present_count >= 0 and infants_present_count <= infants_expected_count),
  prebook_reduction_cents bigint not null default 0 check (prebook_reduction_cents >= 0),
  prebook_reduction_reason text,
  recorded_at timestamptz not null default now(),
  recorded_by uuid not null default auth.uid() references public.profiles (id),
  updated_at timestamptz not null default now(),
  constraint booking_attendance_reduction_reason check (
    prebook_reduction_cents = 0 or nullif(trim(prebook_reduction_reason), '') is not null
  )
);

create trigger booking_attendance_set_updated_at before update on public.booking_attendance
  for each row execute function public.set_updated_at();
create trigger booking_attendance_audit after insert or update or delete on public.booking_attendance
  for each row execute function public.audit_trigger();

alter table public.booking_attendance enable row level security;
revoke all on public.booking_attendance from anon, authenticated;
create policy "office staff read booking attendance" on public.booking_attendance for select to authenticated
  using ((select public.has_role(array['admin', 'accountant', 'receptionist']::public.app_role[])));
grant select on public.booking_attendance to authenticated;

create function public.record_booking_attendance(
  p_booking_id uuid,
  p_adults_present integer,
  p_children_present integer,
  p_infants_present integer,
  p_prebook_reduction_cents bigint,
  p_prebook_reduction_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_adults_expected integer;
  v_children_expected integer;
  v_infants_expected integer;
  v_absent integer;
  v_reduction bigint := coalesce(p_prebook_reduction_cents, 0);
  v_reason text := nullif(trim(p_prebook_reduction_reason), '');
begin
  if not public.has_role(array['admin', 'receptionist']::public.app_role[]) then
    raise exception 'Only reception or an admin can record attendance.';
  end if;
  if p_adults_present is null or p_children_present is null or p_infants_present is null or v_reduction < 0 then
    raise exception 'Enter valid attendance and pre-book adjustment amounts.';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'That booking could not be found.'; end if;
  if v_booking.status = 'cancelled' then raise exception 'Attendance cannot be recorded for a cancelled booking.'; end if;

  select coalesce(sum(count) filter (where participant_type = 'adult'), 0),
         coalesce(sum(count) filter (where participant_type = 'child'), 0),
         coalesce(sum(count) filter (where participant_type = 'infant'), 0)
    into v_adults_expected, v_children_expected, v_infants_expected
    from public.booking_participants where booking_id = p_booking_id;

  if p_adults_present > v_adults_expected or p_children_present > v_children_expected or p_infants_present > v_infants_expected
     or p_adults_present < 0 or p_children_present < 0 or p_infants_present < 0 then
    raise exception 'Attended guests cannot exceed the booked count.';
  end if;

  v_absent := v_adults_expected + v_children_expected + v_infants_expected
    - p_adults_present - p_children_present - p_infants_present;
  if v_reduction > 0 then
    if v_booking.payer <> 'operator' then
      raise exception 'A pre-book reduction is available only when the operator owes AquaSail.';
    end if;
    if v_absent = 0 then
      raise exception 'A pre-book reduction can only be entered when guests did not attend.';
    end if;
    if v_reduction > v_booking.operator_net_total_cents then
      raise exception 'The pre-book reduction cannot exceed the amount the operator owes AquaSail.';
    end if;
    v_reason := coalesce(v_reason, 'No-show attendance adjustment');
  else
    v_reason := null;
  end if;

  insert into public.booking_attendance (
    booking_id,
    adults_expected_count, adults_present_count,
    children_expected_count, children_present_count,
    infants_expected_count, infants_present_count,
    prebook_reduction_cents, prebook_reduction_reason,
    recorded_at, recorded_by
  ) values (
    p_booking_id,
    v_adults_expected, p_adults_present,
    v_children_expected, p_children_present,
    v_infants_expected, p_infants_present,
    v_reduction, v_reason,
    now(), auth.uid()
  )
  on conflict (booking_id) do update set
    adults_expected_count = excluded.adults_expected_count,
    adults_present_count = excluded.adults_present_count,
    children_expected_count = excluded.children_expected_count,
    children_present_count = excluded.children_present_count,
    infants_expected_count = excluded.infants_expected_count,
    infants_present_count = excluded.infants_present_count,
    prebook_reduction_cents = excluded.prebook_reduction_cents,
    prebook_reduction_reason = excluded.prebook_reduction_reason,
    recorded_at = excluded.recorded_at,
    recorded_by = excluded.recorded_by;
end;
$$;

revoke all on function public.record_booking_attendance(uuid, integer, integer, integer, bigint, text) from public, anon;
grant execute on function public.record_booking_attendance(uuid, integer, integer, integer, bigint, text) to authenticated;

-- Operator net in the shared register is the current amount owed to AquaSail;
-- the source booking row keeps the original priced snapshot unchanged.
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
  greatest(0, b.operator_net_total_cents - coalesce(ba.prebook_reduction_cents, 0))::bigint as operator_net_total_cents,
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
  b.hotel_name,
  coalesce(ba.prebook_reduction_cents, 0)::bigint as prebook_reduction_cents
from public.bookings b
join public.clients c on c.id = b.client_id
left join public.tour_operators o on o.id = b.operator_id
left join public.booking_attendance ba on ba.booking_id = b.id
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

-- Waiver requirements switch to the recorded present count when attendance is
-- saved; before that, they continue to use the original booked counts.
create function public.booking_waiver_required_count(p_booking_id uuid, p_participant_type public.participant_type)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select case p_participant_type
      when 'adult' then adults_present_count
      when 'child' then children_present_count
      when 'infant' then infants_present_count
    end
    from public.booking_attendance where booking_id = p_booking_id),
    (select coalesce(sum(count), 0)::integer
     from public.booking_participants
     where booking_id = p_booking_id and participant_type = p_participant_type),
    0
  );
$$;
revoke all on function public.booking_waiver_required_count(uuid, public.participant_type) from public, anon, authenticated;

create or replace function public.get_booking_waiver(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.booking_waiver_links;
  v_booking public.bookings;
  v_adult_required integer;
  v_child_required integer;
  v_infant_required integer;
  v_adult_signed integer;
  v_child_signed integer;
  v_infant_signed integer;
begin
  if p_token !~ '^[A-Za-z0-9_-]{43}$' then return jsonb_build_object('valid', false); end if;
  select * into v_link from public.booking_waiver_links
  where token_hash = encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex')
    and revoked_at is null;
  if not found then return jsonb_build_object('valid', false); end if;
  select * into v_booking from public.bookings where id = v_link.booking_id;
  if not found or v_booking.status = 'cancelled'
     or (now() at time zone 'Indian/Mauritius')::date > v_link.expires_on then
    return jsonb_build_object('valid', false);
  end if;

  v_adult_required := public.booking_waiver_required_count(v_booking.id, 'adult');
  v_child_required := public.booking_waiver_required_count(v_booking.id, 'child');
  v_infant_required := public.booking_waiver_required_count(v_booking.id, 'infant');
  if v_adult_required + v_child_required + v_infant_required = 0 then
    return jsonb_build_object('valid', false);
  end if;
  select count(*) filter (where participant_type = 'adult'),
         count(*) filter (where participant_type = 'child'),
         count(*) filter (where participant_type = 'infant')
    into v_adult_signed, v_child_signed, v_infant_signed
    from public.booking_waivers where booking_id = v_booking.id;

  return jsonb_build_object(
    'valid', true,
    'reference', v_booking.reference,
    'service_date', v_booking.service_date,
    'disclaimer_text', v_link.disclaimer_text,
    'adult_required', v_adult_required,
    'child_required', v_child_required,
    'infant_required', v_infant_required,
    'adult_signed', v_adult_signed,
    'child_signed', v_child_signed,
    'infant_signed', v_infant_signed,
    'required_count', v_adult_required + v_child_required + v_infant_required,
    'signed_count', v_adult_signed + v_child_signed + v_infant_signed,
    'complete', v_adult_signed >= v_adult_required and v_child_signed >= v_child_required and v_infant_signed >= v_infant_required
  );
end;
$$;

create or replace function public.submit_booking_waiver(
  p_token text,
  p_participant_type text,
  p_participant_name text,
  p_signer_name text,
  p_signer_relationship text,
  p_signature_data text,
  p_guardian_authority_confirmed boolean,
  p_submission_id uuid,
  p_acknowledged boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.booking_waiver_links;
  v_booking public.bookings;
  v_required integer;
  v_signed integer;
  v_total_required integer;
  v_total_signed integer;
begin
  if p_token is null or p_participant_type is null or p_signer_relationship is null or p_submission_id is null
     or p_token !~ '^[A-Za-z0-9_-]{43}$' or p_participant_type not in ('adult', 'child', 'infant')
     or p_signer_relationship not in ('self', 'parent', 'legal_guardian')
     or p_acknowledged is distinct from true
     or p_participant_name is null or length(trim(p_participant_name)) not between 1 and 160
     or p_signer_name is null or length(trim(p_signer_name)) not between 1 and 160
     or p_signature_data is null or length(p_signature_data) > 500000
     or p_signature_data !~ '^data:image/png;base64,[A-Za-z0-9+/]+=*$' then
    raise exception 'Complete the name, consent and signature fields.';
  end if;
  if p_participant_type = 'adult' and p_signer_relationship = 'self'
     and lower(trim(p_participant_name)) <> lower(trim(p_signer_name)) then
    raise exception 'For an adult signing for themselves, the signer name must match the participant name.';
  end if;
  if p_participant_type = 'adult' and p_signer_relationship <> 'self'
     and p_signer_relationship not in ('parent', 'legal_guardian') then
    raise exception 'Choose who is signing for this participant.';
  end if;
  if p_participant_type <> 'adult' and p_signer_relationship not in ('parent', 'legal_guardian') then
    raise exception 'A parent or legal guardian must sign for a child or infant.';
  end if;
  if p_signer_relationship in ('parent', 'legal_guardian') and p_guardian_authority_confirmed is distinct from true then
    raise exception 'Confirm that you are authorized to sign as the parent or legal guardian.';
  end if;
  if p_signer_relationship = 'self' and p_guardian_authority_confirmed is distinct from false then
    raise exception 'Invalid signer confirmation.';
  end if;

  select * into v_link from public.booking_waiver_links
  where token_hash = encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex')
    and revoked_at is null;
  if not found then raise exception 'This waiver link is invalid or has expired.'; end if;
  select * into v_booking from public.bookings where id = v_link.booking_id for update;
  if not found or v_booking.status = 'cancelled'
     or (now() at time zone 'Indian/Mauritius')::date > v_link.expires_on then
    raise exception 'This waiver link is invalid or has expired.';
  end if;

  v_required := public.booking_waiver_required_count(v_booking.id, p_participant_type::public.participant_type);
  v_signed := (select count(*) from public.booking_waivers
    where booking_id = v_booking.id and participant_type = p_participant_type::public.participant_type);
  v_total_required := public.booking_waiver_required_count(v_booking.id, 'adult')
    + public.booking_waiver_required_count(v_booking.id, 'child')
    + public.booking_waiver_required_count(v_booking.id, 'infant');
  v_total_signed := (select count(*) from public.booking_waivers where booking_id = v_booking.id);

  if v_total_required = 0 then raise exception 'No guests are currently required to sign.'; end if;
  if exists (select 1 from public.booking_waivers where booking_id = v_booking.id and submission_id = p_submission_id) then
    return jsonb_build_object('signed_count', v_total_signed, 'required_count', v_total_required, 'complete', v_total_signed >= v_total_required);
  end if;
  if v_required = 0 or v_signed >= v_required then
    raise exception 'All waivers for this participant type have already been recorded.';
  end if;
  if v_total_signed >= v_total_required then raise exception 'All participants have already signed.'; end if;

  insert into public.booking_waivers (
    submission_id, booking_id, participant_type, participant_name, signer_name, signer_relationship,
    guardian_authority_confirmed, signature_data, disclaimer_text
  ) values (
    p_submission_id, v_booking.id, p_participant_type::public.participant_type, trim(p_participant_name), trim(p_signer_name),
    p_signer_relationship, p_guardian_authority_confirmed, p_signature_data, v_link.disclaimer_text
  );

  return jsonb_build_object('signed_count', v_total_signed + 1, 'required_count', v_total_required, 'complete', v_total_signed + 1 >= v_total_required);
end;
$$;

revoke all on function public.submit_booking_waiver(text, text, text, text, text, text, boolean, uuid, boolean) from public;
grant execute on function public.submit_booking_waiver(text, text, text, text, text, text, boolean, uuid, boolean) to anon, authenticated;
