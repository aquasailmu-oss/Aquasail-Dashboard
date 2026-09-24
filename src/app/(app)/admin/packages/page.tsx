import type { Metadata } from "next";
import { ComingSoon } from "@/components/shell/coming-soon";
import { requireRole } from "@/lib/auth";

export const metadata: Metadata = { title: "Packages · AquaSail Ops" };

export default async function PackagesPage() {
  await requireRole(["admin"]);
  return <ComingSoon title="Packages" description="Package builder." arrives="WP-11" />;
}
