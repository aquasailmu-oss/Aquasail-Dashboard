import type { Metadata } from "next";
import { ActivityForm } from "@/components/catalogue/activity-form";
import { PageHeader } from "@/components/shell/page-header";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "New activity · AquaSail Ops" };

export default async function NewActivityPage() {
  await requireRole(["admin"]);
  const supabase = await createClient();
  const { data: last } = await supabase
    .from("activities")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <>
      <PageHeader title="New activity" description="Set its prices afterwards in Pricing." />
      <ActivityForm nextSortOrder={(last?.sort_order ?? 0) + 10} />
    </>
  );
}
