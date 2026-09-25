import type { Metadata } from "next";
import { ClientForm } from "@/components/clients/client-form";
import { PageHeader } from "@/components/shell/page-header";
import { requireRole } from "@/lib/auth";

export const metadata: Metadata = { title: "New client · AquaSail Ops" };

export default async function NewClientPage() {
  await requireRole(["admin", "receptionist"]);
  return (
    <>
      <PageHeader
        title="New client"
        description="Phone and email are optional. Existing customers are flagged as you type."
      />
      <ClientForm />
    </>
  );
}
