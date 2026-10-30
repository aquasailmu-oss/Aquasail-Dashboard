-- WP-22 (V2): the fifth role. The person who can correct a redemption has to
-- be standing where it happened (V2 plan §10.1); a supervisor reverses and
-- resolves redemptions and registers devices, and still sees no money.
--
-- This is its own migration on purpose: Postgres will not let a transaction
-- use an enum value it added itself, and 0019 uses it in policies and seeds.

alter type public.app_role add value 'activity_supervisor';
