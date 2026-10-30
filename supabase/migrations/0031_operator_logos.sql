-- Operator logos are public branding assets used on the booking source screen.
alter table public.tour_operators
  add column logo_path text
  check (logo_path is null or (char_length(logo_path) <= 200 and logo_path !~ '(^/|\.\.)'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('operator-logos', 'operator-logos', true, 1048576, array['image/png', 'image/jpeg', 'image/webp']);

create policy "admins read operator logos" on storage.objects for select to authenticated
  using (bucket_id = 'operator-logos' and (select public.is_admin()));
create policy "admins upload operator logos" on storage.objects for insert to authenticated
  with check (bucket_id = 'operator-logos' and (select public.is_admin()));
create policy "admins replace operator logos" on storage.objects for update to authenticated
  using (bucket_id = 'operator-logos' and (select public.is_admin()))
  with check (bucket_id = 'operator-logos' and (select public.is_admin()));
create policy "admins remove operator logos" on storage.objects for delete to authenticated
  using (bucket_id = 'operator-logos' and (select public.is_admin()));
