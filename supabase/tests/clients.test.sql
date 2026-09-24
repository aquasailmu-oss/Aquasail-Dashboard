-- WP-10: find_similar_clients(), client_summaries and append_client_note().
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000b2', 'rec@test.local', '{"role":"receptionist","full_name":"Rita Ramsamy"}'),
  ('00000000-0000-0000-0000-0000000000c3', 'acc@test.local', '{"role":"accountant","full_name":"Carl"}');
insert into public.clients (id, first_name, last_name, phone_e164, email) values
  ('00000000-0000-0000-0000-00000000c001', 'Priyamvada', 'Ramgoolam-Testcase', '+23059990001', 'Priya.Test@Example.com'),
  ('00000000-0000-0000-0000-00000000c002', 'Zebedee', 'Unrelatedperson', null, null);
insert into public.bookings (reference, client_id, source_type, service_date, status, cancelled_at, cancellation_reason) values
  ('T-1', '00000000-0000-0000-0000-00000000c001', 'walk_in', public.today_mauritius() - 10, 'confirmed', null, null),
  ('T-2', '00000000-0000-0000-0000-00000000c001', 'walk_in', public.today_mauritius() - 3, 'completed', null, null),
  ('T-3', '00000000-0000-0000-0000-00000000c001', 'walk_in', public.today_mauritius() - 1, 'cancelled', now(), 'Weather'),
  ('T-4', '00000000-0000-0000-0000-00000000c001', 'walk_in', public.today_mauritius() + 5, 'confirmed', null, null);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);

select results_eq(
  $$select booking_count, last_visit from public.client_summaries where id = '00000000-0000-0000-0000-00000000c001'$$,
  $$values (3, public.today_mauritius() - 3)$$,
  'bookings exclude cancellations; last visit ignores cancelled and future dates');

select results_eq(
  $$select id, confidence, match_reason from public.find_similar_clients(p_phone_e164 => '+23059990001')$$,
  $$values ('00000000-0000-0000-0000-00000000c001'::uuid, 'high'::text, 'Same phone number'::text)$$,
  'the same phone is a high-confidence match');
select results_eq(
  $$select confidence from public.find_similar_clients(p_email => 'priya.test@example.COM')$$,
  $$values ('high'::text)$$,
  'email matching ignores case');
select results_eq(
  $$select id, confidence from public.find_similar_clients(p_first_name => 'Priyamvda', p_last_name => 'Ramgolam-Testcase')$$,
  $$values ('00000000-0000-0000-0000-00000000c001'::uuid, 'possible'::text)$$,
  'a misspelt name is a possible match');
select is_empty(
  $$select 1 from public.find_similar_clients(p_first_name => 'Completely', p_last_name => 'Different')$$,
  'an unrelated name matches nobody');
select is_empty(
  $$select 1 from public.find_similar_clients(p_first_name => 'Zeb')$$,
  'very short input does not produce noise');
select is(
  (select count(*)::int from public.find_similar_clients('Priyamvada', 'Ramgoolam-Testcase', '+23059990001', 'priya.test@example.com')),
  1, 'a client matching on several fields is listed once');
select is(
  (select confidence from public.find_similar_clients('Priyamvada', 'Ramgoolam-Testcase', '+23059990001', null)),
  'high', 'and at their highest confidence');

select matches(
  public.append_client_note('00000000-0000-0000-0000-00000000c001', 'Prefers the front of the boat'),
  '^\d{1,2} \w{3} \d{4} \d{2}:\d{2}, Rita Ramsamy: Prefers the front of the boat$',
  'a note is dated and signed by the author');
select matches(
  public.append_client_note('00000000-0000-0000-0000-00000000c001', 'Second visit'),
  E'Prefers the front of the boat\n.*Second visit$',
  'notes are appended, never replaced');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}', true);
select throws_ok(
  $$select public.append_client_note('00000000-0000-0000-0000-00000000c001', 'x')$$,
  'P0001', null, 'an accountant cannot add notes');

select * from finish();
rollback;
