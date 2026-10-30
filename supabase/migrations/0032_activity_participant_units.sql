-- Catalogue activities are stable sellable variants. For example, create
-- Parasailing Single and Parasailing Double as separate activity rows and set
-- the latter to two participants per operational ride. Booking and pricing
-- quantities remain participant counts.
alter table public.activities
  add column if not exists participants_per_unit integer not null default 1
  check (participants_per_unit between 1 and 20);

comment on column public.activities.participants_per_unit is
  'Number of participants carried by one operational unit of this activity; booking quantities and ticket summaries remain participant counts.';
