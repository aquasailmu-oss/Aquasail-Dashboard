-- WP-11: catalogue administration.

-- ---------------------------------------------------------------------------
-- Codes are stable keys (price lists, exports and the fleet rule refer to
-- 'CATAMARAN'): once created they never change.
-- ---------------------------------------------------------------------------

create function public.forbid_code_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.code is distinct from old.code then
    raise exception 'A code cannot be changed once created (% stays %). Create a new item instead.', tg_table_name, old.code;
  end if;
  return new;
end;
$$;

create trigger activities_code_immutable before update of code on public.activities
  for each row execute function public.forbid_code_change();
create trigger packages_code_immutable before update of code on public.packages
  for each row execute function public.forbid_code_change();
create trigger tour_operators_code_immutable before update of code on public.tour_operators
  for each row execute function public.forbid_code_change();

-- ---------------------------------------------------------------------------
-- save_package(payload): creates or updates a package and replaces its
-- activity list in one transaction. The only way activities leave a package:
-- package_activities is composition, not a catalogue row, so a removed link
-- is deleted here (and the audit trigger records it). Bookings are not
-- affected: each booking keeps its own expanded entitlements.
--
-- payload: {id?, code, name, description?, pricing_mode, is_active,
--           activities: [{activity_id, quantity_per_participant, is_optional}]}
-- ---------------------------------------------------------------------------

create function public.save_package(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := nullif(payload ->> 'id', '')::uuid;
  v_code text := upper(trim(payload ->> 'code'));
  v_name text := nullif(trim(payload ->> 'name'), '');
  v_mode text := payload ->> 'pricing_mode';
  v_lines jsonb := coalesce(payload -> 'activities', '[]'::jsonb);
  v_line record;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can change packages.';
  end if;
  if v_name is null then
    raise exception 'Give the package a name.';
  end if;
  if v_mode is null or v_mode not in ('bundle', 'components') then
    raise exception 'Choose how the package is priced.';
  end if;
  if jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 then
    raise exception 'Add at least one activity to the package.';
  end if;
  if (select count(distinct l ->> 'activity_id') from jsonb_array_elements(v_lines) l) <> jsonb_array_length(v_lines) then
    raise exception 'An activity appears twice. Use its quantity instead.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_lines) l
    where coalesce((l ->> 'quantity_per_participant')::int, 0) < 1
  ) then
    raise exception 'Each activity needs a quantity of at least 1 per participant.';
  end if;
  -- Activities newly added must be active; ones already in the package may stay.
  if exists (
    select 1 from jsonb_array_elements(v_lines) l
    join public.activities a on a.id = (l ->> 'activity_id')::uuid
    where not a.is_active
      and not exists (
        select 1 from public.package_activities pa where pa.package_id = v_id and pa.activity_id = a.id
      )
  ) then
    raise exception 'A deactivated activity cannot be added to a package.';
  end if;

  if v_id is null then
    if v_code is null or v_code !~ '^[A-Z0-9_]{2,30}$' then
      raise exception 'Use a code of 2 to 30 capital letters, digits or underscores, e.g. SUNSET.';
    end if;
    begin
      insert into public.packages (code, name, description, pricing_mode, is_active)
      values (v_code, v_name, nullif(trim(payload ->> 'description'), ''), v_mode,
              coalesce((payload ->> 'is_active')::boolean, true))
      returning id into v_id;
    exception when unique_violation then
      raise exception 'A package with the code % already exists.', v_code;
    end;
  else
    update public.packages
    set name = v_name,
        description = nullif(trim(payload ->> 'description'), ''),
        pricing_mode = v_mode,
        is_active = coalesce((payload ->> 'is_active')::boolean, is_active)
    where id = v_id;
    if not found then
      raise exception 'That package no longer exists.';
    end if;
  end if;

  delete from public.package_activities
  where package_id = v_id
    and activity_id not in (select (l ->> 'activity_id')::uuid from jsonb_array_elements(v_lines) l);

  for v_line in
    select (l ->> 'activity_id')::uuid as activity_id,
           (l ->> 'quantity_per_participant')::int as quantity,
           coalesce((l ->> 'is_optional')::boolean, false) as is_optional,
           (n * 10)::int as sort_order
    from jsonb_array_elements(v_lines) with ordinality as t(l, n)
  loop
    insert into public.package_activities (package_id, activity_id, quantity_per_participant, is_optional, sort_order)
    values (v_id, v_line.activity_id, v_line.quantity, v_line.is_optional, v_line.sort_order)
    on conflict (package_id, activity_id) do update
      set quantity_per_participant = excluded.quantity_per_participant,
          is_optional = excluded.is_optional,
          sort_order = excluded.sort_order
      where (package_activities.quantity_per_participant, package_activities.is_optional, package_activities.sort_order)
        is distinct from (excluded.quantity_per_participant, excluded.is_optional, excluded.sort_order);
  end loop;

  return v_id;
end;
$$;

revoke execute on function public.save_package(jsonb) from public, anon;
grant execute on function public.save_package(jsonb) to authenticated;
