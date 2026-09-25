"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/lib/auth";
import type { Database } from "@/lib/database.types";
import { friendlyDbError } from "@/lib/db-errors";
import { normalizePhone } from "@/lib/phone";
import { fail, ok, type Result } from "@/lib/result";
import { createClient } from "@/lib/supabase/server";

export type ClientMatch = Database["public"]["Functions"]["find_similar_clients"]["Returns"][number];

const WRITERS = ["admin", "receptionist"] as const;
const READERS = ["admin", "accountant", "receptionist"] as const;

const clientSchema = z.object({
  first_name: z.string().trim().min(1, "Enter the first name.").max(80, "That first name is too long."),
  last_name: z.string().trim().max(80, "That last name is too long."),
  phone: z.string().trim().max(40, "That phone number is too long."),
  email: z.union([z.literal(""), z.email("Enter a valid email address, or leave it empty.").trim().toLowerCase()]),
  country: z.string().trim().max(60, "That country name is too long."),
});

type ClientFields = {
  first_name: string;
  last_name: string;
  phone_e164: string | null;
  email: string | null;
  country: string | null;
};

function parseClient(formData: FormData): Result<ClientFields> {
  const parsed = clientSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the form and try again.");
  const { first_name, last_name, phone, email, country } = parsed.data;
  let phone_e164: string | null = null;
  if (phone) {
    const normalized = normalizePhone(phone);
    if (!normalized.ok) return fail(normalized.error);
    phone_e164 = normalized.e164;
  }
  return ok({ first_name, last_name, phone_e164, email: email || null, country: country || null });
}

/** Explains a duplicate phone by naming who already has it. */
async function duplicatePhoneMessage(phone: string): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase.from("clients").select("first_name, last_name").eq("phone_e164", phone).maybeSingle();
  const who = data ? `${data.first_name} ${data.last_name}`.trim() : "Another client";
  return `${who} already has this phone number. Open their record instead of creating a new one.`;
}

export async function createClientRecord(formData: FormData): Promise<Result<{ id: string }>> {
  const auth = await authorize(WRITERS);
  if (!auth.ok) return auth;
  const fields = parseClient(formData);
  if (!fields.ok) return fields;
  const notes = String(formData.get("notes") ?? "").trim();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .insert({ ...fields.data, notes: notes || null })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505" && fields.data.phone_e164)
      return fail(await duplicatePhoneMessage(fields.data.phone_e164));
    return fail(friendlyDbError(error, "The client could not be saved. Try again."));
  }
  revalidatePath("/clients");
  return ok({ id: data.id });
}

export async function updateClientRecord(formData: FormData): Promise<Result<{ id: string }>> {
  const auth = await authorize(WRITERS);
  if (!auth.ok) return auth;
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return fail("That client could not be found.");
  const fields = parseClient(formData);
  if (!fields.ok) return fields;

  const supabase = await createClient();
  const { data, error } = await supabase.from("clients").update(fields.data).eq("id", id.data).select("id");
  if (error) {
    if (error.code === "23505" && fields.data.phone_e164)
      return fail(await duplicatePhoneMessage(fields.data.phone_e164));
    return fail(friendlyDbError(error, "The changes could not be saved. Try again."));
  }
  if (!data?.length) return fail("That client could not be found.");
  revalidatePath("/clients");
  revalidatePath(`/clients/${id.data}`);
  return ok({ id: id.data });
}

const noteSchema = z.object({
  client_id: z.uuid(),
  note: z.string().trim().min(1, "Write the note first.").max(1000, "Keep a note under 1,000 characters."),
});

export async function addClientNote(formData: FormData): Promise<Result<null>> {
  const auth = await authorize(WRITERS);
  if (!auth.ok) return auth;
  const parsed = noteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Write the note first.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("append_client_note", {
    p_client_id: parsed.data.client_id,
    p_note: parsed.data.note,
  });
  if (error) return fail(friendlyDbError(error, "The note could not be saved. Try again."));
  revalidatePath(`/clients/${parsed.data.client_id}`);
  return ok(null);
}

const similarSchema = z.object({
  first_name: z.string().trim().max(80).default(""),
  last_name: z.string().trim().max(80).default(""),
  phone: z.string().trim().max(40).default(""),
  email: z.string().trim().max(200).default(""),
  exclude_id: z.uuid().optional(),
});

/**
 * Existing clients who might be the person being entered: same phone or
 * email (high confidence), or a similar name (possible). Reused by the
 * booking wizard. Incomplete input is fine; it just matches less.
 */
export async function findSimilarClients(input: z.input<typeof similarSchema>): Promise<Result<ClientMatch[]>> {
  const auth = await authorize(READERS);
  if (!auth.ok) return auth;
  const parsed = similarSchema.safeParse(input);
  if (!parsed.success) return ok([]);
  const { first_name, last_name, phone, email, exclude_id } = parsed.data;

  const normalized = phone ? normalizePhone(phone) : null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("find_similar_clients", {
    p_first_name: first_name || undefined,
    p_last_name: last_name || undefined,
    p_phone_e164: normalized?.ok ? normalized.e164 : undefined,
    p_email: email.includes("@") ? email : undefined,
  });
  if (error) return fail("Could not check for existing clients.");
  return ok((data ?? []).filter((m) => m.id !== exclude_id));
}
