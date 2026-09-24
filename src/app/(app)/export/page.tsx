import type { Metadata } from "next";
import { ComingSoon } from "@/components/shell/coming-soon";
import { requireRole } from "@/lib/auth";

export const metadata: Metadata = { title: "Export · AquaSail Ops" };

export default async function ExportPage() {
  await requireRole(["admin", "accountant"]);
  return <ComingSoon title="Export" description="Bookings to Excel for a date range." arrives="WP-17" />;
}
