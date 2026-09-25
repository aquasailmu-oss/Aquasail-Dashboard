-- WP-21: a health probe for /api/health. Callable without signing in; says
-- only that the database answers and which migration it is on.

create function public.health_check()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'database', 'ok',
    'schema_version', (select max(version) from supabase_migrations.schema_migrations)
  );
$$;

revoke execute on function public.health_check() from public;
grant execute on function public.health_check() to anon, authenticated;
