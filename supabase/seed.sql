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
