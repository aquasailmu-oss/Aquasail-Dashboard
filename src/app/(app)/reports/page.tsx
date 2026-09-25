import type { Metadata } from "next";
import { ComingSoon } from "@/components/shell/coming-soon";
import { requireRole } from "@/lib/auth";

export const metadata: Metadata = { title: "Reports · AquaSail Ops" };

export default async function ReportsPage() {
  await requireRole(["admin", "accountant"]);
  return <ComingSoon title="Reports" description="Revenue and operator reporting." arrives="V3" />;
}
