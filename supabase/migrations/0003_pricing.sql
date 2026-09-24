-- WP-04: effective-dated pricing. One row = one price for one thing, one
-- audience, one participant type, over one date range. Prices are never
-- overwritten: set_price() closes the current row and inserts the next.

create extension if not exists btree_gist with schema extensions;

create type public.participant_type as enum ('adult', 'child', 'infant');
create type public.price_audience as enum ('walk_in', 'operator');

-- Today's business date in Mauritius. Used by policies and functions; the
-- application uses businessDate() in src/lib/dates.ts for the same thing.
create function public.today_mauritius()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Indian/Mauritius')::date;
$$;

create table public.price_rules (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('activity', 'package')),
  activity_id uuid references public.activities (id),
  package_id uuid references public.packages (id),
  audience public.price_audience not null,
  operator_id uuid references public.tour_operators (id),
  participant_type public.participant_type not null,
  retail_cents bigint not null check (retail_cents >= 0),
  net_cents bigint check (net_cents >= 0),
  commission_rate numeric(5, 4) check (commission_rate >= 0 and commission_rate <= 1),
  effective_from date not null,
  effective_to date, -- null = open-ended; exclusive upper bound
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),

  constraint price_rules_one_target check (
    (scope = 'activity' and activity_id is not null and package_id is null)
    or (scope = 'package' and package_id is not null and activity_id is null)
  ),
  constraint price_rules_operator_iff_operator_audience check (
    (audience = 'operator') = (operator_id is not null)
  ),
  -- Net prices and commission rates only mean something for an operator.
  constraint price_rules_walk_in_is_retail_only check (
    audience = 'operator' or (net_cents is null and commission_rate is null)
  ),
  constraint price_rules_valid_range check (effective_to is null or effective_to > effective_from),
  -- Overlapping rules are what silently mischarge customers; make them unrepresentable.
  constraint price_rules_no_overlap exclude using gist (
    scope with =,
    (coalesce(activity_id, package_id)) with =,
    audience with =,
    (coalesce(operator_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    participant_type with =,
    daterange(effective_from, effective_to, '[)') with &&
  )
);

create index price_rules_activity_idx on public.price_rules (activity_id) where activity_id is not null;
create index price_rules_package_idx on public.price_rules (package_id) where package_id is not null;
create index price_rules_operator_idx on public.price_rules (operator_id) where operator_id is not null;

create trigger price_rules_audit after insert or update or delete on public.price_rules
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- set_price(): the only sanctioned way to change a price.
-- ---------------------------------------------------------------------------

create function public.set_price(
  p_scope text,
  p_activity_id uuid,
  p_package_id uuid,
  p_audience public.price_audience,
  p_operator_id uuid,
  p_participant_type public.participant_type,
  p_retail_cents bigint,
  p_net_cents bigint,
  p_commission_rate numeric,
  p_effective_from date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_open public.price_rules;
  v_new_id uuid;
  v_target_name text;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can change prices.';
  end if;

  if p_effective_from is null then
    raise exception 'Choose the date the new price takes effect.';
  end if;
  if p_effective_from < public.today_mauritius() then
    raise exception 'A price cannot start in the past (% is before today). Past bookings keep the price they were charged.',
      to_char(p_effective_from, 'FMDD Mon YYYY');
  end if;

  if p_scope = 'package' then
    select name into v_target_name from public.packages
    where id = p_package_id and pricing_mode = 'bundle';
    if v_target_name is null then
      raise exception 'This package is priced as the sum of its activities. Set the activity prices instead.';
    end if;
  end if;

  select * into v_open
  from public.price_rules
  where scope = p_scope
    and activity_id is not distinct from p_activity_id
    and package_id is not distinct from p_package_id
    and audience = p_audience
    and operator_id is not distinct from p_operator_id
    and participant_type = p_participant_type
    and effective_to is null
  for update;

  if found then
    if p_effective_from <= v_open.effective_from then
      raise exception 'The new price must start after % (when the current price started).',
        to_char(v_open.effective_from, 'FMDD Mon YYYY');
    end if;
    update public.price_rules set effective_to = p_effective_from where id = v_open.id;
  end if;

  begin
    insert into public.price_rules (
      scope, activity_id, package_id, audience, operator_id, participant_type,
      retail_cents, net_cents, commission_rate, effective_from, created_by
    ) values (
      p_scope, p_activity_id, p_package_id, p_audience, p_operator_id, p_participant_type,
      p_retail_cents, p_net_cents, p_commission_rate, p_effective_from, auth.uid()
    )
    returning id into v_new_id;
  exception
    when exclusion_violation then
      raise exception 'Another price already covers % for this item. Check the price history.',
        to_char(p_effective_from, 'FMDD Mon YYYY');
    when check_violation then
      raise exception 'That price is not valid: check the item, the operator and that amounts are not negative.';
  end;

  return v_new_id;
end;
$$;

revoke execute on function public.set_price from public, anon;
grant execute on function public.set_price to authenticated;

-- ---------------------------------------------------------------------------
-- RLS. Receptionists never read price_rules; they only receive computed
-- quotes from the server. Nobody writes directly; set_price() does.
-- ---------------------------------------------------------------------------

alter table public.price_rules enable row level security;
revoke all on table public.price_rules from anon;
revoke insert, update, delete, truncate on table public.price_rules from authenticated;

create policy "admins and accountants read prices"
  on public.price_rules for select
  to authenticated
  using ((select public.has_role(array['admin', 'accountant']::public.app_role[])));
