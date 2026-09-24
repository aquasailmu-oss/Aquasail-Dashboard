-- Withdrawing a scheduled price that has not started (approved by the owner
-- after WP-15). set_price() never overwrites, so a typo in a price scheduled
-- for next month could otherwise only be fixed by stacking another price
-- after it. A scheduled price that nothing can have been charged at may be
-- withdrawn: the rule is deleted (the audit log keeps it) and the price
-- before it is extended to cover the gap.

create function public.withdraw_scheduled_price(p_rule_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule public.price_rules;
  v_previous uuid;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can change prices.';
  end if;

  select * into v_rule from public.price_rules where id = p_rule_id for update;
  if not found then
    raise exception 'That price no longer exists.';
  end if;
  if v_rule.effective_from <= public.today_mauritius() then
    raise exception 'This price has already started. Set a new price from a later date instead.';
  end if;

  -- Any booking in the rule's date range for the same item, directly or
  -- inside a package (components packages record no rule id), blocks it.
  if exists (
    select 1
    from public.bookings b
    join public.booking_items i on i.booking_id = b.id
    left join public.packages p on p.id = i.package_id
    left join public.package_activities pa on pa.package_id = p.id and p.pricing_mode = 'components'
    where b.status <> 'cancelled'
      and b.service_date >= v_rule.effective_from
      and (v_rule.effective_to is null or b.service_date < v_rule.effective_to)
      and i.participant_type = v_rule.participant_type
      and (
        i.price_rule_id = v_rule.id
        or (v_rule.package_id is not null and i.package_id = v_rule.package_id)
        or (v_rule.activity_id is not null and (i.activity_id = v_rule.activity_id or pa.activity_id = v_rule.activity_id))
      )
  ) then
    raise exception 'Bookings already exist in this price''s dates. Set a new price from a later date instead.';
  end if;

  select id into v_previous
  from public.price_rules
  where scope = v_rule.scope
    and activity_id is not distinct from v_rule.activity_id
    and package_id is not distinct from v_rule.package_id
    and audience = v_rule.audience
    and operator_id is not distinct from v_rule.operator_id
    and participant_type = v_rule.participant_type
    and effective_to = v_rule.effective_from;

  delete from public.price_rules where id = v_rule.id;
  if v_previous is not null then
    update public.price_rules set effective_to = v_rule.effective_to where id = v_previous;
  end if;
end;
$$;

revoke execute on function public.withdraw_scheduled_price(uuid) from public, anon;
grant execute on function public.withdraw_scheduled_price(uuid) to authenticated;
