-- WP-10: client list summaries, duplicate detection, and notes.

-- ---------------------------------------------------------------------------
-- client_summaries: each client with their booking count and last visit.
-- security_invoker, so the caller's RLS on clients and bookings applies
-- (activity_staff see nothing).
-- ---------------------------------------------------------------------------

create view public.client_summaries
with (security_invoker = true) as
select
  c.id,
  c.first_name,
  c.last_name,
  c.phone_e164,
  c.email,
  c.country,
  c.search_text,
  c.created_at,
  coalesce(b.booking_count, 0)::int as booking_count,
  b.last_visit
from public.clients c
left join lateral (
  select
    count(*) filter (where status <> 'cancelled') as booking_count,
    max(service_date) filter (where status <> 'cancelled' and service_date <= public.today_mauritius()) as last_visit
  from public.bookings
  where client_id = c.id
) b on true;

revoke all on public.client_summaries from anon;
grant select on public.client_summaries to authenticated;

-- ---------------------------------------------------------------------------
-- find_similar_clients(): the "existing customer found" lookup, used by the
-- client form and the booking wizard. An exact phone or email match is
-- 'high' confidence; a similar full name is 'possible'.
-- security invoker: RLS decides who may run it usefully.
-- ---------------------------------------------------------------------------

create function public.find_similar_clients(
  p_first_name text default null,
  p_last_name text default null,
  p_phone_e164 text default null,
  p_email text default null
)
returns table (
  id uuid,
  first_name text,
  last_name text,
  phone_e164 text,
  email text,
  country text,
  confidence text,
  match_reason text,
  booking_count int,
  last_visit date
)
language sql
stable
set search_path = ''
as $$
  with input as (
    select
      nullif(trim(p_phone_e164), '') as phone,
      nullif(lower(trim(p_email)), '') as email,
      nullif(lower(trim(concat_ws(' ', nullif(trim(p_first_name), ''), nullif(trim(p_last_name), '')))), '') as full_name
  ),
  matches as (
    select c.id, 1 as rank, 'high' as confidence, 'Same phone number' as reason, 1.0::real as score
    from public.clients c, input i
    where i.phone is not null and c.phone_e164 = i.phone
    union all
    select c.id, 1, 'high', 'Same email address', 1.0::real
    from public.clients c, input i
    where i.email is not null and lower(c.email) = i.email
    union all
    select c.id, 2, 'possible', 'Similar name',
           extensions.similarity(lower(c.first_name || ' ' || c.last_name), i.full_name)
    from public.clients c, input i
    where i.full_name is not null
      and length(i.full_name) >= 4
      and extensions.similarity(lower(c.first_name || ' ' || c.last_name), i.full_name) >= 0.45
  ),
  best as (
    select distinct on (m.id) m.id, m.rank, m.confidence, m.reason, m.score
    from matches m
    order by m.id, m.rank, m.score desc
  )
  select s.id, s.first_name, s.last_name, s.phone_e164, s.email, s.country,
         b.confidence, b.reason, s.booking_count, s.last_visit
  from best b
  join public.client_summaries s on s.id = b.id
  order by b.rank, b.score desc, s.last_visit desc nulls last
  limit 5;
$$;

revoke execute on function public.find_similar_clients(text, text, text, text) from public, anon;
grant execute on function public.find_similar_clients(text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- append_client_note(): adds a dated, signed line to a client's notes in
-- one statement (no read-modify-write race between two desks).
-- security invoker: the clients update policy decides who may.
-- ---------------------------------------------------------------------------

create function public.append_client_note(p_client_id uuid, p_note text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_note text := nullif(trim(p_note), '');
  v_author text;
  v_notes text;
begin
  if v_note is null then
    raise exception 'Write the note first.';
  end if;
  select full_name into v_author from public.profiles where id = auth.uid();

  update public.clients
  set notes = concat_ws(
    E'\n',
    nullif(notes, ''),
    to_char(now() at time zone 'Indian/Mauritius', 'FMDD Mon YYYY HH24:MI') || ', ' || coalesce(v_author, 'unknown') || ': ' || v_note
  )
  where id = p_client_id
  returning notes into v_notes;

  if not found then
    raise exception 'That client could not be updated. They may have been removed from your view, or your role cannot edit clients.';
  end if;
  return v_notes;
end;
$$;

revoke execute on function public.append_client_note(uuid, text) from public, anon;
grant execute on function public.append_client_note(uuid, text) to authenticated;
