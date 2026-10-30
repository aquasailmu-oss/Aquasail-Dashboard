-- Booking-specific public waiver links and immutable participant signatures.
-- Only the hash of each bearer token is stored; public callers can reach data
-- only through narrowly scoped SECURITY DEFINER RPCs.

create table public.booking_waiver_links (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  disclaimer_text text not null check (length(trim(disclaimer_text)) between 1 and 5000),
  expires_on date not null,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references public.profiles (id),
  revoked_at timestamptz
);

create index booking_waiver_links_booking_idx on public.booking_waiver_links (booking_id);
alter table public.booking_waiver_links enable row level security;
revoke all on public.booking_waiver_links from anon, authenticated;

create table public.booking_waivers (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  participant_type public.participant_type not null,
  participant_name text not null check (length(trim(participant_name)) between 1 and 160),
  signer_name text not null check (length(trim(signer_name)) between 1 and 160),
  signer_relationship text not null check (signer_relationship in ('self', 'parent', 'legal_guardian')),
  guardian_authority_confirmed boolean not null default false,
  signature_data text not null check (
    length(signature_data) <= 500000 and signature_data ~ '^data:image/png;base64,[A-Za-z0-9+/]+=*$'
  ),
  disclaimer_text text not null check (length(trim(disclaimer_text)) between 1 and 5000),
  signed_at timestamptz not null default now(),
  constraint booking_waivers_self_signer check (
    (participant_type = 'adult' and signer_relationship = 'self' and lower(trim(participant_name)) = lower(trim(signer_name)) and not guardian_authority_confirmed)
    or (signer_relationship in ('parent', 'legal_guardian') and guardian_authority_confirmed)
  )
);

create index booking_waivers_booking_idx on public.booking_waivers (booking_id, signed_at);
alter table public.booking_waivers enable row level security;
revoke all on public.booking_waivers from anon, authenticated;
create policy "office staff read booking waivers" on public.booking_waivers for select to authenticated
  using ((select public.has_role(array['admin', 'accountant', 'receptionist']::public.app_role[])));
grant select on public.booking_waivers to authenticated;

-- Waiver evidence is append-only. Corrections are handled by adding a fresh
-- record through an explicit new signing link; old evidence remains intact.
create function public.reject_booking_waiver_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Signed waiver evidence cannot be changed or deleted.';
end;
$$;

create trigger booking_waivers_immutable before update or delete on public.booking_waivers
  for each row execute function public.reject_booking_waiver_change();

create function public.create_booking_waiver_link(p_booking_id uuid, p_token text)
returns date
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_disclaimer text;
  v_expires_on date;
begin
  if not public.has_role(array['admin', 'receptionist']::public.app_role[]) then
    raise exception 'Your role does not allow this.';
  end if;
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'Could not create a waiver link.';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found or v_booking.status = 'cancelled' then
    raise exception 'A waiver link is not available for this booking.';
  end if;
  if v_booking.service_date < public.today_mauritius() then
    raise exception 'A waiver link cannot be created for a past booking.';
  end if;

  select value #>> '{}' into v_disclaimer from public.app_settings where key = 'ticket_disclaimer_text';
  if v_disclaimer is null or length(trim(v_disclaimer)) = 0 or lower(ltrim(v_disclaimer)) like 'disclaimer placeholder%' then
    raise exception 'Set the approved waiver text in Settings before creating a waiver link.';
  end if;
  if length(v_disclaimer) > 5000 then
    raise exception 'The waiver text is too long.';
  end if;

  v_expires_on := v_booking.service_date;
  -- There is exactly one active bearer link per booking. Reissuing it
  -- immediately invalidates a link that may have been shared accidentally.
  update public.booking_waiver_links set revoked_at = now()
  where booking_id = p_booking_id and revoked_at is null;
  insert into public.booking_waiver_links (booking_id, token_hash, disclaimer_text, expires_on, created_by)
  values (
    p_booking_id,
    encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex'),
    v_disclaimer,
    v_expires_on,
    auth.uid()
  );
  return v_expires_on;
end;
$$;

create function public.revoke_booking_waiver_links(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_role(array['admin', 'receptionist']::public.app_role[]) then
    raise exception 'Your role does not allow this.';
  end if;
  update public.booking_waiver_links set revoked_at = now()
  where booking_id = p_booking_id and revoked_at is null;
end;
$$;

create function public.get_booking_waiver(p_token text)
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

  select coalesce(sum(count) filter (where participant_type = 'adult'), 0),
         coalesce(sum(count) filter (where participant_type = 'child'), 0),
         coalesce(sum(count) filter (where participant_type = 'infant'), 0)
    into v_adult_required, v_child_required, v_infant_required
    from public.booking_participants where booking_id = v_booking.id;
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

create function public.submit_booking_waiver(
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

  select count(*) into v_total_signed from public.booking_waivers
  where booking_id = v_booking.id and submission_id = p_submission_id;
  if v_total_signed > 0 then
    select coalesce(sum(count), 0) into v_total_required from public.booking_participants where booking_id = v_booking.id;
    select count(*) into v_total_signed from public.booking_waivers where booking_id = v_booking.id;
    return jsonb_build_object('signed_count', v_total_signed, 'required_count', v_total_required, 'complete', v_total_signed >= v_total_required);
  end if;

  select coalesce(sum(count), 0) into v_required
    from public.booking_participants where booking_id = v_booking.id and participant_type = p_participant_type::public.participant_type;
  select count(*) into v_signed
    from public.booking_waivers where booking_id = v_booking.id and participant_type = p_participant_type::public.participant_type;
  if v_required = 0 or v_signed >= v_required then
    raise exception 'All waivers for this participant type have already been recorded.';
  end if;
  select coalesce(sum(count), 0) into v_total_required from public.booking_participants where booking_id = v_booking.id;
  select count(*) into v_total_signed from public.booking_waivers where booking_id = v_booking.id;
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

revoke all on function public.create_booking_waiver_link(uuid, text) from public, anon;
revoke all on function public.revoke_booking_waiver_links(uuid) from public, anon;
revoke all on function public.get_booking_waiver(text) from public;
revoke all on function public.submit_booking_waiver(text, text, text, text, text, text, boolean, uuid, boolean) from public;
grant execute on function public.create_booking_waiver_link(uuid, text) to authenticated;
grant execute on function public.revoke_booking_waiver_links(uuid) to authenticated;
grant execute on function public.get_booking_waiver(text) to anon, authenticated;
grant execute on function public.submit_booking_waiver(text, text, text, text, text, text, boolean, uuid, boolean) to anon, authenticated;

-- Keep the signer count at or below the booking's participant count if staff
-- amend a booking after people have signed.
create function public.prevent_participant_count_below_waivers()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_signed integer;
begin
  if tg_op = 'DELETE' then
    select count(*) into v_signed from public.booking_waivers
    where booking_id = old.booking_id and participant_type = old.participant_type;
    if v_signed > 0 then raise exception 'Remove or transfer the signed participants before reducing this count.'; end if;
    return old;
  end if;
  select count(*) into v_signed from public.booking_waivers
  where booking_id = new.booking_id and participant_type = new.participant_type;
  if new.count < v_signed then
    raise exception 'The participant count cannot be lower than the number of signed waivers.';
  end if;
  return new;
end;
$$;

create trigger booking_participants_keep_waiver_count before insert or update or delete on public.booking_participants
  for each row execute function public.prevent_participant_count_below_waivers();
