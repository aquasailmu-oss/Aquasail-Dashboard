import type { Metadata } from "next";
import { OperatorForm } from "@/components/operators/operator-form";
import { PageHeader } from "@/components/shell/page-header";
import { requireRole } from "@/lib/auth";

export const metadata: Metadata = { title: "New operator · AquaSail Ops" };

export default async function NewOperatorPage() {
  await requireRole(["admin"]);
  return (
    <>
      <PageHeader
        title="New tour operator"
        description="Get the commercial terms in writing before configuring them here."
      />
      <OperatorForm />
    </>
  );
}
