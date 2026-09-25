-- WP-18: count ticket prints atomically (two quick reprints both count).
-- security invoker: the tickets update policy (admin, reception) and the
-- printed_count column grant decide who may.

create function public.mark_ticket_printed(p_token text)
returns int
language sql
set search_path = ''
as $$
  update public.tickets set printed_count = printed_count + 1
  where token = p_token
  returning printed_count;
$$;

revoke execute on function public.mark_ticket_printed(text) from public, anon;
grant execute on function public.mark_ticket_printed(text) to authenticated;
