import type { Metadata } from "next";
import { ComingSoon } from "@/components/shell/coming-soon";
import { requireRole } from "@/lib/auth";

export const metadata: Metadata = { title: "Scan · AquaSail Ops" };

export default async function ScanPage() {
  await requireRole(["activity_staff"]);
  return <ComingSoon title="Scan" description="Scan tickets and redeem activities on the island." arrives="V2" />;
}
