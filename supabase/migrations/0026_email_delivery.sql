-- WP-31 (V2): email delivery plumbing. A security definer function handles
-- the message_log writes so the receptionist's RLS session can trigger a
-- send without direct table grants.

-- log_delivery_attempt(): creates a 'queued' message_log row before the
-- provider is called. Returns the row's id for the update after calling.
create function public.log_delivery_attempt(
  p_booking_id uuid,
  p_ticket_id uuid,
  p_channel text,
  p_template text,
  p_to_address text,
  p_provider text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.app_role := public.auth_role();
  v_id uuid;
  v_attempt int;
begin
  if v_role is null or v_role not in ('admin', 'receptionist') then
    raise exception 'Your role cannot send tickets.';
  end if;

  select coalesce(max(ml.attempt), 0) + 1 into v_attempt
  from public.message_log ml
  where ml.booking_id = p_booking_id and ml.channel = p_channel;

  insert into public.message_log (
    booking_id, ticket_id, channel, template, to_address,
    status, provider, attempt, sent_by
  ) values (
    p_booking_id, p_ticket_id, p_channel, p_template, p_to_address,
    'queued', p_provider, v_attempt, auth.uid()
  ) returning id into v_id;

  return v_id;
end;
$$;

-- update_delivery_status(): called after the provider responds (or fails).
create function public.update_delivery_status(
  p_log_id uuid,
  p_status text,
  p_provider_message_id text default null,
  p_error_code text default null,
  p_error_detail text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.app_role := public.auth_role();
begin
  if v_role is null or v_role not in ('admin', 'receptionist') then
    raise exception 'Your role cannot update delivery status.';
  end if;

  if p_status not in ('sent', 'failed') then
    raise exception 'Status must be sent or failed.';
  end if;

  update public.message_log
  set status = p_status,
      provider_message_id = coalesce(p_provider_message_id, provider_message_id),
      error_code = p_error_code,
      error_detail = p_error_detail,
      sent_at = case when p_status = 'sent' then now() else sent_at end
  where id = p_log_id;
end;
$$;

-- update_delivery_webhook(): called from the Resend webhook route handler
-- with the admin client. Updates delivery/read timestamps.
create function public.update_delivery_webhook(
  p_provider_message_id text,
  p_event text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_event = 'delivered' then
    update public.message_log
    set status = 'delivered', delivered_at = now()
    where provider_message_id = p_provider_message_id
      and status in ('sent', 'queued');
  elsif p_event = 'opened' then
    update public.message_log
    set status = 'read', read_at = now()
    where provider_message_id = p_provider_message_id
      and status in ('sent', 'delivered');
  elsif p_event = 'bounced' or p_event = 'complained' then
    update public.message_log
    set status = 'failed', error_code = p_event,
        error_detail = 'Provider reported ' || p_event
    where provider_message_id = p_provider_message_id;
  end if;
end;
$$;

-- Grants
revoke execute on function public.log_delivery_attempt(uuid, uuid, text, text, text, text) from public, anon;
grant execute on function public.log_delivery_attempt(uuid, uuid, text, text, text, text) to authenticated;

revoke execute on function public.update_delivery_status(uuid, text, text, text, text) from public, anon;
grant execute on function public.update_delivery_status(uuid, text, text, text, text) to authenticated;

revoke execute on function public.update_delivery_webhook(text, text) from public, anon;
grant execute on function public.update_delivery_webhook(text, text) to authenticated;
