-- Keep customer acknowledgement with the ticket snapshot it applies to.
alter table public.tickets
  add column signature_data text,
  add column signer_name text,
  add column signed_at timestamptz,
  add column disclaimer_text text;

alter table public.tickets
  add constraint tickets_signature_fields_together check (
    (signature_data is null and signer_name is null and signed_at is null and disclaimer_text is null)
    or (signature_data is not null and nullif(trim(signer_name), '') is not null
        and signed_at is not null and nullif(trim(disclaimer_text), '') is not null)
  );

grant update (signature_data, signer_name, signed_at, disclaimer_text) on public.tickets to authenticated;
