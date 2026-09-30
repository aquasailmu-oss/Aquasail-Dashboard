-- WP-26 (V2): reissue, revocation on cancel, one live ticket per booking, and
-- what an old token scans as.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000026b2', 'rec@t26.local', '{"role":"receptionist","full_name":"Rita"}'),
  ('00000000-0000-0000-0000-0000000026c3', 'acc@t26.local', '{"role":"accountant","full_name":"Carl"}'),
  ('00000000-0000-0000-0000-0000000026d4', 'staff@t26.local', '{"role":"activity_staff","full_name":"Sam"}');
insert into public.clients (id, first_name, last_name) values ('00000000-0000-0000-0000-00000026c001', 'Jo', 'Smith');
insert into public.bookings (id, reference, client_id, source_type, service_date) values
  ('00000000-0000-0000-0000-00000026b001', 'WS-T26-LOST', '00000000-0000-0000-0000-00000026c001', 'walk_in', public.today_mauritius()),
  ('00000000-0000-0000-0000-00000026b002', 'WS-T26-CANC', '00000000-0000-0000-0000-00000026c001', 'walk_in', public.today_mauritius());
insert into public.tickets (booking_id, token) values
  ('00000000-0000-0000-0000-00000026b001', 'tok-lost-1'),
  ('00000000-0000-0000-0000-00000026b002', 'tok-canc');

-- The test's own lookups, past RLS.
create function pg_temp.ticket(p_token text) returns public.tickets language sql security definer as $$
  select * from public.tickets where token = p_token
$$;
create function pg_temp.live_count(p_booking uuid) returns int language sql security definer as $$
  select count(*)::int from public.tickets where booking_id = p_booking and revoked_at is null
$$;

select throws_ok(
  $$insert into public.tickets (booking_id) values ('00000000-0000-0000-0000-00000026b001')$$,
  '23505', null, 'a booking cannot have two live tickets');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000026b2","role":"authenticated"}', true);

-- Reissue for a lost phone
create temp table t (name text primary key, token text);
grant all on t to authenticated;
insert into t select 'second', public.reissue_ticket('00000000-0000-0000-0000-00000026b001', 'Lost phone') ->> 'token';
select results_eq(
  $$select revoked_at is not null, revoked_by, revoke_reason from pg_temp.ticket('tok-lost-1')$$,
  $$values (true, '00000000-0000-0000-0000-0000000026b2'::uuid, 'Lost phone')$$,
  'the old ticket is revoked at once, with who and why');
select is((pg_temp.ticket((select token from t where name = 'second'))).reissued_from_ticket_id,
  (pg_temp.ticket('tok-lost-1')).id, 'the new ticket records which one it replaced');
select is(pg_temp.live_count('00000000-0000-0000-0000-00000026b001'), 1, 'exactly one live ticket remains');
select matches((select token from t where name = 'second'), '^[0-9a-f]{32}$', 'the new ticket has a fresh random token');
select is(public.scan_ticket('tok-lost-1') ->> 'verdict', 'REVOKED', 'the old token scans as REVOKED, not NOT_FOUND');
select is(public.scan_ticket((select token from t where name = 'second')) ->> 'verdict', 'VALID', 'the new token scans as VALID');
insert into t select 'third', public.reissue_ticket('00000000-0000-0000-0000-00000026b001', 'Sent to the wrong number') ->> 'token';
select is((pg_temp.ticket((select token from t where name = 'third'))).reissued_from_ticket_id,
  (pg_temp.ticket((select token from t where name = 'second'))).id, 'a second reissue chains from the one before');
select is(pg_temp.live_count('00000000-0000-0000-0000-00000026b001'), 1, 'still exactly one live ticket');
select throws_ok($$select public.reissue_ticket('00000000-0000-0000-0000-00000026b001', ' ')$$,
  'P0001', 'Give a reason for reissuing the ticket.', 'a reissue needs a reason');

-- Cancelling revokes
update public.bookings set status = 'cancelled', cancellation_reason = 'Weather' where id = '00000000-0000-0000-0000-00000026b002';
select results_eq(
  $$select revoked_at is not null, revoke_reason from pg_temp.ticket('tok-canc')$$,
  $$values (true, 'Booking cancelled: Weather')$$, 'cancelling a booking revokes its ticket');
select is(public.scan_ticket('tok-canc') ->> 'verdict', 'CANCELLED', 'a cancelled booking''s ticket scans as CANCELLED, not REVOKED');
select throws_ok($$select public.reissue_ticket('00000000-0000-0000-0000-00000026b002', 'Lost phone')$$,
  'P0001', 'This booking is cancelled, so its ticket cannot be reissued.', 'a cancelled booking''s ticket is not reissued');

-- Who
select throws_ok($$select public.revoke_ticket((pg_temp.ticket('tok-lost-1')).id, 'x')$$,
  '42501', null, 'nobody revokes a ticket directly');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000026c3","role":"authenticated"}', true);
select throws_ok($$select public.reissue_ticket('00000000-0000-0000-0000-00000026b001', 'x')$$,
  'P0001', 'Only reception or an admin can reissue a ticket.', 'an accountant cannot reissue');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000026d4","role":"authenticated"}', true);
select throws_ok($$select public.reissue_ticket('00000000-0000-0000-0000-00000026b001', 'x')$$,
  'P0001', 'Only reception or an admin can reissue a ticket.', 'island staff cannot reissue');

reset role;
select is((select count(*)::int from public.tickets where booking_id = '00000000-0000-0000-0000-00000026b001'), 3,
  'no ticket is ever deleted: all three are kept');

select * from finish();
rollback;
