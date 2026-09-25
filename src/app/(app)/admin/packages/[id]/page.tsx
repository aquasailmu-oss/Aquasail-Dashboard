import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PackageBuilder } from "@/components/catalogue/package-builder";
import { PageHeader } from "@/components/shell/page-header";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Edit package · AquaSail Ops" };

export default async function EditPackagePage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["admin"]);
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: pkg }, { data: activities }] = await Promise.all([
    supabase
      .from("packages")
      .select(
        "id, code, name, description, pricing_mode, is_active, package_activities(activity_id, quantity_per_participant, is_optional, sort_order)",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.from("activities").select("id, code, name, is_active").order("sort_order").order("name"),
  ]);
  if (!pkg) notFound();

  const lines = [...pkg.package_activities]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(({ activity_id, quantity_per_participant, is_optional }) => ({
      activity_id,
      quantity_per_participant,
      is_optional,
    }));

  return (
    <>
      <PageHeader title={`Edit ${pkg.name}`} />
      <PackageBuilder
        pkg={{ ...pkg, pricing_mode: pkg.pricing_mode as "bundle" | "components", lines }}
        activities={activities ?? []}
      />
    </>
  );
}
