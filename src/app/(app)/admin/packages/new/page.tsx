import type { Metadata } from "next";
import { PackageBuilder } from "@/components/catalogue/package-builder";
import { PageHeader } from "@/components/shell/page-header";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "New package · AquaSail Ops" };

export default async function NewPackagePage() {
  await requireRole(["admin"]);
  const supabase = await createClient();
  const { data: activities } = await supabase
    .from("activities")
    .select("id, code, name, is_active")
    .order("sort_order")
    .order("name");
  return (
    <>
      <PageHeader title="New package" />
      <PackageBuilder activities={activities ?? []} />
    </>
  );
}
