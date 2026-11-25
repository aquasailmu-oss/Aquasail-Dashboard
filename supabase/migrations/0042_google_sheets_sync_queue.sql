-- Durable, retryable work queue for the optional Google Sheets booking mirror.
-- The queue is created even before Google credentials are configured; no
-- booking path depends on the external service being available.
create table public.booking_sheet_sync_queue (
  booking_id uuid primary key references public.bookings (id) on delete cascade,
  requested_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  locked_until timestamptz,
  last_error text
);

alter table public.booking_sheet_sync_queue enable row level security;
revoke all on public.booking_sheet_sync_queue from public, anon, authenticated;
grant all on public.booking_sheet_sync_queue to service_role;

create function public.enqueue_booking_sheet_sync(p_booking_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.booking_sheet_sync_queue (booking_id, requested_at, attempts, locked_until, last_error)
  values (p_booking_id, now(), 0, null, null)
  on conflict (booking_id) do update
    set requested_at = excluded.requested_at,
        last_error = null;
$$;
revoke all on function public.enqueue_booking_sheet_sync(uuid) from public, anon, authenticated;

create function public.queue_booking_sheet_sync_from_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.enqueue_booking_sheet_sync(new.id);
  return new;
end;
$$;

create trigger queue_booking_sheet_sync_from_booking
after insert or update on public.bookings
for each row execute function public.queue_booking_sheet_sync_from_booking();

create function public.queue_booking_sheet_sync_from_child()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking_id uuid;
begin
  if tg_op = 'DELETE' then
    v_booking_id := old.booking_id;
  else
    v_booking_id := new.booking_id;
  end if;
  perform public.enqueue_booking_sheet_sync(v_booking_id);
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger queue_booking_sheet_sync_from_item
after insert or update or delete on public.booking_items
for each row execute function public.queue_booking_sheet_sync_from_child();
create trigger queue_booking_sheet_sync_from_participant
after insert or update or delete on public.booking_participants
for each row execute function public.queue_booking_sheet_sync_from_child();
create trigger queue_booking_sheet_sync_from_payment
after insert or update or delete on public.payments
for each row execute function public.queue_booking_sheet_sync_from_child();

create function public.queue_booking_sheet_sync_from_client()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking_id uuid;
begin
  for v_booking_id in select b.id from public.bookings b where b.client_id = new.id loop
    perform public.enqueue_booking_sheet_sync(v_booking_id);
  end loop;
  return new;
end;
$$;

create trigger queue_booking_sheet_sync_from_client
after update of first_name, last_name, phone_e164, email, country on public.clients
for each row execute function public.queue_booking_sheet_sync_from_client();

-- A worker claims rows atomically. Expired locks let another run recover after
-- a crashed worker, while SKIP LOCKED prevents concurrent runs claiming the
-- same booking at once.
create function public.claim_booking_sheet_sync_jobs(p_limit integer default 25)
returns table (booking_id uuid, requested_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with candidates as (
    select q.booking_id
    from public.booking_sheet_sync_queue q
    where q.locked_until is null or q.locked_until < now()
    order by q.requested_at, q.booking_id
    limit least(greatest(coalesce(p_limit, 25), 1), 100)
    for update skip locked
  )
  update public.booking_sheet_sync_queue q
  set locked_until = now() + interval '5 minutes',
      attempts = q.attempts + 1
  from candidates c
  where q.booking_id = c.booking_id
  returning q.booking_id, q.requested_at;
end;
$$;
revoke all on function public.claim_booking_sheet_sync_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_booking_sheet_sync_jobs(integer) to service_role;
