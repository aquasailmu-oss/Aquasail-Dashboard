import type { Metadata } from "next";
import { ComingSoon } from "@/components/shell/coming-soon";
import { requireRole } from "@/lib/auth";

export const metadata: Metadata = { title: "Activities · AquaSail Ops" };

export default async function ActivitiesPage() {
  await requireRole(["admin"]);
  return <ComingSoon title="Activities" description="The activity catalogue." arrives="WP-11" />;
}
