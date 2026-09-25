import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OperatorForm } from "@/components/operators/operator-form";
import { PageHeader } from "@/components/shell/page-header";
import { requireRole } from "@/lib/auth";
import type { Payer, SettlementModel } from "@/lib/operators";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Edit operator · AquaSail Ops" };

export default async function EditOperatorPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["admin"]);
  const { id } = await params;
  const supabase = await createClient();
  const { data: o } = await supabase.from("tour_operators").select("*").eq("id", id).maybeSingle();
  if (!o) notFound();
  return (
    <>
      <PageHeader title={`Edit ${o.name}`} />
      <OperatorForm
        operator={{ ...o, settlement_model: o.settlement_model as SettlementModel, payer: o.payer as Payer }}
      />
    </>
  );
}
