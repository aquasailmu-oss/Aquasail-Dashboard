import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActivityForm } from "@/components/catalogue/activity-form";
import { PageHeader } from "@/components/shell/page-header";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Edit activity · AquaSail Ops" };

export default async function EditActivityPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["admin"]);
  const { id } = await params;
  const supabase = await createClient();
  const { data: activity } = await supabase
    .from("activities")
    .select("id, code, name, description, is_redeemable, default_duration_minutes, sort_order")
    .eq("id", id)
    .maybeSingle();
  if (!activity) notFound();

  return (
    <>
      <PageHeader title={`Edit ${activity.name}`} />
      <ActivityForm activity={activity} nextSortOrder={activity.sort_order} />
    </>
  );
}
