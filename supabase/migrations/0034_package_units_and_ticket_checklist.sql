-- Packages may be sold per person or as a fixed package unit that covers a
-- configured number of people. Inclusion quantities are counts per sold unit.
alter table public.packages
  add column sale_unit text not null default 'participant'
    check (sale_unit in ('participant', 'package')),
  add column participants_per_unit integer not null default 1
    check (participants_per_unit between 1 and 20),
  add constraint packages_participant_sale_unit_size check (
    sale_unit <> 'participant' or participants_per_unit = 1
  );

-- This product is sold for two people at one package price. Its existing
-- inclusion quantities (2 of each activity) already describe one unit.
update public.packages
set sale_unit = 'package', participants_per_unit = 2
where code = 'COMBO_DOUBLE';

-- Preserve the sale unit used by each historical purchase, even if an admin
-- later changes the catalogue package.
alter table public.booking_items
  add column sale_unit_snapshot text not null default 'participant'
    check (sale_unit_snapshot in ('participant', 'package')),
  add column participants_per_unit_snapshot integer not null default 1
    check (participants_per_unit_snapshot between 1 and 20);

create function public.snapshot_booking_item_unit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.line_type = 'package' then
    select p.sale_unit, p.participants_per_unit
      into new.sale_unit_snapshot, new.participants_per_unit_snapshot
    from public.packages p
    where p.id = new.package_id;
    if not found then
      raise exception 'That package no longer exists.';
    end if;
  else
    new.sale_unit_snapshot := 'participant';
    new.participants_per_unit_snapshot := 1;
  end if;
  return new;
end;
$$;

create trigger booking_items_snapshot_unit
  before insert or update of line_type, package_id on public.booking_items
  for each row execute function public.snapshot_booking_item_unit();

-- A booking's declared guest count must cover the largest selected product
-- group. Multiple activity entitlements may belong to the same guests, so
-- they are not added together. Package units of the same package are grouped.
create function public.check_booking_guest_coverage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking_id uuid;
  v_guests integer;
  v_required integer;
begin
  if tg_op = 'DELETE' then
    v_booking_id := old.booking_id;
  else
    v_booking_id := new.booking_id;
  end if;

  select coalesce(sum(bp.count), 0) into v_guests
  from public.booking_participants bp where bp.booking_id = v_booking_id;

  select greatest(
    coalesce((select max(package_people) from (
      select sum(bi.quantity * bi.participants_per_unit_snapshot)::integer as package_people
      from public.booking_items bi
      where bi.booking_id = v_booking_id and bi.line_type = 'package'
      group by bi.package_id
    ) package_groups), 0),
    coalesce((select max(activity_people) from (
      select sum(bi.quantity)::integer as activity_people
      from public.booking_items bi
      where bi.booking_id = v_booking_id and bi.line_type = 'activity'
      group by bi.activity_id
    ) activity_groups), 0)
  ) into v_required;

  if v_guests < v_required then
    raise exception 'This booking needs at least % people for the selected package and activity quantities; it currently has %.',
      v_required, v_guests;
  end if;
  return null;
end;
$$;

create constraint trigger booking_items_guest_coverage
  after insert or update or delete on public.booking_items
  deferrable initially deferred
  for each row execute function public.check_booking_guest_coverage();

create constraint trigger booking_participants_guest_coverage
  after insert or update or delete on public.booking_participants
  deferrable initially deferred
  for each row execute function public.check_booking_guest_coverage();

-- Extend the admin-only package writer to persist unit size and sale basis.
create or replace function public.save_package(payload jsonb)
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
  v_sale_unit text := coalesce(payload ->> 'sale_unit', 'participant');
  v_pax_per_unit integer := coalesce((payload ->> 'participants_per_unit')::integer, 1);
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
  if v_sale_unit not in ('participant', 'package') or v_pax_per_unit < 1 or v_pax_per_unit > 20
    or (v_sale_unit = 'participant' and v_pax_per_unit <> 1) then
    raise exception 'Choose a valid sale unit and number of people it covers.';
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
    raise exception 'Each included activity needs a quantity of at least 1 per package unit.';
  end if;
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
      insert into public.packages (
        code, name, description, pricing_mode, sale_unit, participants_per_unit, is_active
      ) values (
        v_code, v_name, nullif(trim(payload ->> 'description'), ''), v_mode, v_sale_unit, v_pax_per_unit,
        coalesce((payload ->> 'is_active')::boolean, true)
      ) returning id into v_id;
    exception when unique_violation then
      raise exception 'A package with the code % already exists.', v_code;
    end;
  else
    update public.packages
    set name = v_name,
        description = nullif(trim(payload ->> 'description'), ''),
        pricing_mode = v_mode,
        sale_unit = v_sale_unit,
        participants_per_unit = v_pax_per_unit,
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
