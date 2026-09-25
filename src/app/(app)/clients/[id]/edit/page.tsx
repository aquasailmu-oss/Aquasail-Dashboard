import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ClientForm } from "@/components/clients/client-form";
import { PageHeader } from "@/components/shell/page-header";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Edit client · AquaSail Ops" };

export default async function EditClientPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["admin", "receptionist"]);
  const { id } = await params;
  const supabase = await createClient();
  const { data: client } = await supabase
    .from("clients")
    .select("id, first_name, last_name, phone_e164, email, country")
    .eq("id", id)
    .maybeSingle();
  if (!client) notFound();

  return (
    <>
      <PageHeader title={`Edit ${client.first_name} ${client.last_name}`} />
      <ClientForm client={client} />
    </>
  );
}
