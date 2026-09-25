-- WP-13: pricing administration.

-- ---------------------------------------------------------------------------
-- set_prices_bulk(changes): applies a reviewed list of price changes (a
-- seasonal increase across a column or row) in one transaction, through
-- set_price() for each, so a bulk load is all-or-nothing and every rule is
-- still closed-and-replaced, never overwritten.
--
-- changes: [{scope, activity_id?, package_id?, audience, operator_id?,
--            participant_type, retail_cents, net_cents?, commission_rate?,
--            effective_from}]
-- ---------------------------------------------------------------------------

create function public.set_prices_bulk(changes jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_change jsonb;
  v_count int := 0;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can change prices.';
  end if;
  if jsonb_typeof(changes) <> 'array' or jsonb_array_length(changes) = 0 then
    raise exception 'There are no price changes to apply.';
  end if;

  for v_change in select * from jsonb_array_elements(changes) loop
    perform public.set_price(
      p_scope => v_change ->> 'scope',
      p_audience => (v_change ->> 'audience')::public.price_audience,
      p_participant_type => (v_change ->> 'participant_type')::public.participant_type,
      p_retail_cents => (v_change ->> 'retail_cents')::bigint,
      p_effective_from => (v_change ->> 'effective_from')::date,
      p_activity_id => (v_change ->> 'activity_id')::uuid,
      p_package_id => (v_change ->> 'package_id')::uuid,
      p_operator_id => (v_change ->> 'operator_id')::uuid,
      p_net_cents => (v_change ->> 'net_cents')::bigint,
      p_commission_rate => (v_change ->> 'commission_rate')::numeric
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.set_prices_bulk(jsonb) from public, anon;
grant execute on function public.set_prices_bulk(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- price_rule_history(): every rule for one activity or package, oldest
-- first, with the name of whoever set it. For admins and accountants (the
-- accountant opens this when a past booking's price is questioned). Names
-- come from profiles, which accountants cannot read directly.
-- ---------------------------------------------------------------------------

create function public.price_rule_history(p_activity_id uuid default null, p_package_id uuid default null)
returns table (
  id uuid,
  audience public.price_audience,
  operator_id uuid,
  operator_name text,
  participant_type public.participant_type,
  retail_cents bigint,
  net_cents bigint,
  commission_rate numeric,
  effective_from date,
  effective_to date,
  set_by text,
  set_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_role(array['admin', 'accountant']::public.app_role[]) then
    raise exception 'Only admins and accountants can see price history.';
  end if;
  return query
    select r.id, r.audience, r.operator_id, o.name, r.participant_type, r.retail_cents, r.net_cents,
           r.commission_rate, r.effective_from, r.effective_to, p.full_name, r.created_at
    from public.price_rules r
    left join public.tour_operators o on o.id = r.operator_id
    left join public.profiles p on p.id = r.created_by
    where (p_activity_id is not null and r.activity_id = p_activity_id)
       or (p_package_id is not null and r.package_id = p_package_id)
    order by r.effective_from, r.audience, o.name nulls first, r.participant_type;
end;
$$;

revoke execute on function public.price_rule_history(uuid, uuid) from public, anon;
grant execute on function public.price_rule_history(uuid, uuid) to authenticated;
