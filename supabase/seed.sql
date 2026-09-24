-- Local development seed, run by `npm run db:reset` (never by db:push).
-- WP-19 extends this with the catalogue, prices and demo bookings.
--
-- Demo accounts, all with the password demo-password-1:
--   admin@aquasail.test      Admin
--   reception@aquasail.test  Receptionist
--   accounts@aquasail.test   Accountant
--   island@aquasail.test     Activity staff

-- A reset database has no users; a real one always has. Seeding demo
-- accounts into a database with users is refused (e.g. db push --include-seed).
do $$
begin
  if exists (select 1 from auth.users) then
    raise exception 'Refusing to seed: this database already has users. Demo data is for a freshly reset local database only.';
  end if;
end;
$$;
with demo (id, email, role, full_name) as (
  values
    ('00000000-0000-4000-8000-00000000d001'::uuid, 'admin@aquasail.test', 'admin', 'Ada Admin'),
    ('00000000-0000-4000-8000-00000000d002'::uuid, 'reception@aquasail.test', 'receptionist', 'Rita Ramsamy'),
    ('00000000-0000-4000-8000-00000000d003'::uuid, 'accounts@aquasail.test', 'accountant', 'Carl Accountant'),
    ('00000000-0000-4000-8000-00000000d004'::uuid, 'island@aquasail.test', 'activity_staff', 'Sam Island')
),
users as (
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new
  )
  select
    '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email,
    extensions.crypt('demo-password-1', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('role', role, 'full_name', full_name), now(), now(),
    '', '', '', ''
  from demo
  returning id, email
)
insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), id, id::text, jsonb_build_object('sub', id::text, 'email', email), 'email', now(), now(), now()
from users;

-- ---------------------------------------------------------------------------
-- Catalogue, fleet, operators and prices, from the approved prototype
-- (CLAUDE.md, "Catalogue and seed data"). WP-19 adds demo bookings.
-- ---------------------------------------------------------------------------

insert into public.activities (code, name, default_duration_minutes, sort_order) values
  ('CATAMARAN', 'Catamaran Cruise', 240, 10),
  ('PARASAIL', 'Parasailing', 15, 20),
  ('UNDERSEA', 'Undersea Walk', 45, 30),
  ('UNDERSEAPHOTO', 'Undersea Photo', 10, 40),
  ('TUBE', 'Tube Ride', 15, 50),
  ('SPEEDBOAT', 'Speed Boat Ride', 30, 60),
  ('PRIVATEBOAT', 'Private Boat Charter', 360, 70),
  ('ISLANDVISIT', 'Ile aux Cerfs Visit', 180, 80),
  ('LUNCH', 'Beach BBQ Lunch', 60, 90),
  ('SNORKEL', 'Snorkelling', 60, 100);

insert into public.packages (code, name, description, pricing_mode, sort_order) values
  ('ISLANDEXP', 'Island Explorer', 'Full-day catamaran sail, a snorkelling stop, and a beach BBQ lunch.', 'bundle', 10),
  ('SUNSET', 'Sunset Cruise', 'A shorter evening sail along the lagoon.', 'bundle', 20),
  ('ADRENALINE', 'Adrenaline Combo', 'Parasailing plus a tube ride, priced as the sum of both.', 'components', 30),
  ('UNDERSEAPKG', 'Undersea Adventure', 'Helmet-dive walk on the reef, then lunch on the beach.', 'components', 40);

insert into public.package_activities (package_id, activity_id, sort_order)
select p.id, a.id, x.sort_order
from (values
  ('ISLANDEXP', 'CATAMARAN', 10), ('ISLANDEXP', 'SNORKEL', 20), ('ISLANDEXP', 'LUNCH', 30),
  ('SUNSET', 'CATAMARAN', 10),
  ('ADRENALINE', 'PARASAIL', 10), ('ADRENALINE', 'TUBE', 20),
  ('UNDERSEAPKG', 'UNDERSEA', 10), ('UNDERSEAPKG', 'LUNCH', 20)
) as x(package_code, activity_code, sort_order)
join public.packages p on p.code = x.package_code
join public.activities a on a.code = x.activity_code;

insert into public.tour_operators (code, name, settlement_model, default_commission_rate, payer) values
  ('BEACHCOMB', 'Beachcomber Hotel', 'net_rate', null, 'operator'),
  ('VERANDA', 'Veranda Resorts', 'commission', 0.2000, 'client'),
  ('MERVILLE', 'Sofitel Merville', 'commission', 0.1500, 'client'),
  ('HERITAGE', 'Heritage Le Telfair', 'net_rate', null, 'client');

insert into public.resources (code, name, resource_type, capacity, sort_order) values
  ('CAT_A', 'Catamaran A', 'Catamaran', 20, 10),
  ('CAT_B', 'Catamaran B', 'Catamaran', 20, 20),
  ('CATASPEED', 'Cataspeed', 'Speedboat', 12, 30);

-- Walk-in prices, in rupees: [adult, child]; infants free.
insert into public.price_rules (scope, activity_id, audience, participant_type, retail_cents, effective_from, effective_to)
select 'activity', a.id, 'walk_in', t.participant_type, t.rupees * 100, x.effective_from, x.effective_to
from (values
  ('PARASAIL', 2200, 1600, date '2026-01-01', null::date), ('UNDERSEA', 3200, 2400, '2026-01-01', null),
  ('UNDERSEAPHOTO', 600, 400, '2026-01-01', null), ('TUBE', 1200, 900, '2026-01-01', null),
  ('SPEEDBOAT', 1500, 1000, '2026-01-01', null), ('PRIVATEBOAT', 5000, 2500, '2026-01-01', null),
  ('ISLANDVISIT', 2500, 1500, '2026-01-01', null), ('LUNCH', 850, 500, '2026-01-01', null),
  ('SNORKEL', 1100, 800, '2026-01-01', null)
) as x(code, adult, child, effective_from, effective_to)
join public.activities a on a.code = x.code
cross join lateral (values ('adult'::public.participant_type, x.adult), ('child', x.child), ('infant', 0)) as t(participant_type, rupees);

-- The Catamaran's real price history: 1,700 → 1,800 on 1 Sep 2026 → 1,950 on 1 Oct 2026.
insert into public.price_rules (scope, activity_id, audience, participant_type, retail_cents, effective_from, effective_to)
select 'activity', a.id, 'walk_in', x.participant_type::public.participant_type, x.rupees * 100, x.effective_from, x.effective_to
from (values
  ('adult', 1700, date '2026-01-01', date '2026-09-01'), ('adult', 1800, '2026-09-01', '2026-10-01'),
  ('adult', 1950, '2026-10-01', null),
  ('child', 850, '2026-01-01', '2026-09-01'), ('child', 900, '2026-09-01', null),
  ('infant', 0, '2026-01-01', null)
) as x(participant_type, rupees, effective_from, effective_to)
cross join public.activities a where a.code = 'CATAMARAN';

-- Bundle package prices (walk-in).
insert into public.price_rules (scope, package_id, audience, participant_type, retail_cents, effective_from)
select 'package', p.id, 'walk_in', t.participant_type, t.rupees * 100, '2026-01-01'
from (values ('ISLANDEXP', 3200, 1900), ('SUNSET', 2100, 1100)) as x(code, adult, child)
join public.packages p on p.code = x.code
cross join lateral (values ('adult'::public.participant_type, x.adult), ('child', x.child), ('infant', 0)) as t(participant_type, rupees);

-- Net-rate operator prices. Retail is the walk-in price, kept for reference.
insert into public.price_rules (scope, activity_id, package_id, audience, operator_id, participant_type, retail_cents, net_cents, effective_from)
select case when a.id is not null then 'activity' else 'package' end, a.id, p.id, 'operator', o.id,
       t.participant_type, t.retail * 100, t.net * 100, '2026-01-01'
from (values
  ('BEACHCOMB', 'SUNSET', 2100, 1500, 1100, 800),
  ('BEACHCOMB', 'CATAMARAN', 1800, 1300, 900, 650),
  ('HERITAGE', 'PRIVATEBOAT', 5000, 4200, 2500, 2100)
) as x(operator_code, target_code, adult_retail, adult_net, child_retail, child_net)
join public.tour_operators o on o.code = x.operator_code
left join public.activities a on a.code = x.target_code
left join public.packages p on p.code = x.target_code
cross join lateral (values ('adult'::public.participant_type, x.adult_retail, x.adult_net),
                           ('child', x.child_retail, x.child_net), ('infant', 0, 0)) as t(participant_type, retail, net);

-- ---------------------------------------------------------------------------
-- Demo bookings (WP-19): ~60 over the last 30 days plus today and tomorrow,
-- created through create_booking() as the demo receptionist, so every
-- amount comes from the pricing engine exactly as in real use. Deterministic:
-- the same choices on every reset (dates are relative to today).
-- ---------------------------------------------------------------------------

do $$
declare
  v_first text[] := array['Priya','Jean','Aurélie','Tom','Sofia','Rahul','Emma','Luc','Ana','Kevin','Marie','Oliver','Nadia','Yusuf','Chloé','Daniel','Leila','Hugo','Mia','Arjun'];
  v_last text[] := array['Ramgoolam','Dupont','Martin','Smith','Rossi','Patel','Müller','Bernard','Silva','Wong','Laurent','Brown','Joomun','Khan','Moreau','Schmidt','Hassan','Petit','Jones','Nair'];
  v_country text[] := array['Mauritius','France','Réunion','United Kingdom','Italy','India','Germany','South Africa'];
  v_i int;
  v_date date;
  v_op text;
  v_target record;
  v_adults int;
  v_children int;
  v_lines jsonb;
  v_quote jsonb;
  v_booking jsonb;
  v_client uuid;
  v_boat uuid;
  v_paid bigint;
  v_discount jsonb;
  v_method text;
  v_catalogue text[] := array['ISLANDEXP','ADRENALINE','SUNSET','PARASAIL','UNDERSEAPKG','SPEEDBOAT','ISLANDEXP','UNDERSEAPHOTO','TUBE','SNORKEL'];
begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000d002","role":"authenticated"}', false);

  for v_i in 1..66 loop
    v_date := case when v_i <= 60 then public.today_mauritius() - (v_i % 30) else public.today_mauritius() + (v_i % 2) end;
    v_op := case
      when v_i % 5 = 0 then 'BEACHCOMB'
      when v_i % 7 = 0 then 'VERANDA'
      when v_i % 11 = 0 then 'MERVILLE'
      when v_i % 13 = 0 then 'HERITAGE'
    end;

    -- What they bought: Beachcomber sends sunset cruises, Heritage private charters.
    select case when p.id is not null then 'package' else 'activity' end as kind, coalesce(p.id, a.id) as id
      into v_target
      from (select case v_op when 'BEACHCOMB' then 'SUNSET' when 'HERITAGE' then 'PRIVATEBOAT'
                             else v_catalogue[1 + v_i % array_length(v_catalogue, 1)] end as code) c
      left join public.packages p on p.code = c.code
      left join public.activities a on a.code = c.code;
    v_adults := 1 + v_i % 4;
    v_children := case when v_i % 3 = 0 then 1 + v_i % 2 else 0 end;
    v_lines := jsonb_build_array(jsonb_build_object('target_type', v_target.kind, 'target_id', v_target.id, 'participant_type', 'adult', 'quantity', v_adults));
    if v_children > 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('target_type', v_target.kind, 'target_id', v_target.id, 'participant_type', 'child', 'quantity', v_children));
    end if;

    v_discount := case when v_i % 8 = 0 and v_op is null then '{"type":"percent","value":1000,"reason":"Returning guest"}'::jsonb end;
    v_quote := public.build_quote(jsonb_strip_nulls(jsonb_build_object(
      'service_date', v_date, 'operator_id', (select id from public.tour_operators where code = v_op), 'lines', v_lines, 'discount', v_discount)));

    -- A returning customer every so often (the same person again).
    select id into v_client from public.clients where first_name = v_first[1 + v_i % 20] and last_name = v_last[1 + (v_i * 7) % 20];

    v_boat := case when exists (
        select 1 from jsonb_array_elements(v_quote -> 'lines') l
        left join public.package_activities pa on pa.package_id = (l ->> 'package_id')::uuid
        join public.activities a on a.id = coalesce(pa.activity_id, (l ->> 'activity_id')::uuid)
        where a.code = 'CATAMARAN')
      then (select id from public.resources where code = case when v_i % 2 = 0 then 'CAT_A' else 'CAT_B' end) end;

    v_method := (array['cash','cash','card','bank_transfer'])[1 + v_i % 4];
    v_paid := case
      when v_quote ->> 'payer' = 'operator' then 0
      when v_i % 17 = 0 then 0                                                  -- unpaid
      when v_i % 9 = 0 then ((v_quote ->> 'charged_total_cents')::bigint / 2)   -- deposit
      else (v_quote ->> 'charged_total_cents')::bigint
    end;

    v_booking := public.create_booking(jsonb_strip_nulls(jsonb_build_object(
      'idempotency_key', 'demo-' || v_i,
      'client_id', v_client,
      'client', case when v_client is null then jsonb_build_object(
        'first_name', v_first[1 + v_i % 20], 'last_name', v_last[1 + (v_i * 7) % 20],
        'phone_e164', '+2305' || lpad((7000000 + v_i * 1379)::text, 7, '0'),
        'email', lower(v_first[1 + v_i % 20]) || '.' || v_i || '@example.com',
        'country', v_country[1 + v_i % 8]) end,
      'service_date', v_date,
      'operator_id', (select id from public.tour_operators where code = v_op),
      'departure_time', (array['08:30','09:00','10:00','13:30','16:00'])[1 + v_i % 5],
      'resource_id', v_boat,
      'lines', v_lines,
      'discount', v_discount,
      'participants', jsonb_strip_nulls(jsonb_build_array(
        jsonb_build_object('participant_type', 'adult', 'count', v_adults),
        case when v_children > 0 then jsonb_build_object('participant_type', 'child', 'count', v_children) end)) - 'null',
      'payment', case when v_paid > 0 then jsonb_build_object('amount_cents', v_paid, 'method', v_method,
        'reference', case when v_method <> 'cash' then 'DEMO-' || v_i end) end,
      'expected_total_cents', (v_quote ->> 'charged_total_cents')::bigint)));
  end loop;

  -- One payment corrected (charged twice at the till), one booking cancelled with a refund.
  insert into public.payments (booking_id, amount_cents, method, received_from, is_correction, corrects_payment_id, note, recorded_by)
  select p.booking_id, -50000, p.method, 'client', true, p.id, 'Charged Rs 500 too much at the till', '00000000-0000-4000-8000-00000000d002'
  from public.payments p join public.bookings b on b.id = p.booking_id where b.idempotency_key = 'demo-2';

  update public.bookings set status = 'cancelled', cancellation_reason = 'Guest unwell; refunded in full'
  where idempotency_key = 'demo-4';
  insert into public.payments (booking_id, amount_cents, method, received_from, is_correction, corrects_payment_id, note, recorded_by)
  select p.booking_id, -p.amount_cents, p.method, 'client', true, p.id, 'Refund: booking cancelled', '00000000-0000-4000-8000-00000000d002'
  from public.payments p join public.bookings b on b.id = p.booking_id where b.idempotency_key = 'demo-4';

  perform set_config('request.jwt.claims', '', false);

  -- Place each booking and payment at its own service date (they were all
  -- created "now"), and drop the backdated-entry notes seeding added.
  -- Triggers are off for this fix-up only, so the audit log is not flooded.
  set local session_replication_role = replica;
  update public.bookings set
    notes = null,
    created_at = (service_date::timestamp + time '07:45' + (abs(hashtext(reference)) % 40) * interval '1 minute') at time zone 'Indian/Mauritius'
  where idempotency_key like 'demo-%' and service_date <= public.today_mauritius();
  update public.payments p set received_at = b.created_at + interval '5 minutes', created_at = b.created_at + interval '5 minutes'
  from public.bookings b where b.id = p.booking_id and b.idempotency_key like 'demo-%' and b.service_date <= public.today_mauritius()
    and not p.is_correction;
  set local session_replication_role = origin;
end;
$$;
