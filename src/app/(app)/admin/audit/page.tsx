import type { Metadata } from "next";
import { ComingSoon } from "@/components/shell/coming-soon";
import { requireRole } from "@/lib/auth";

export const metadata: Metadata = { title: "Audit log · AquaSail Ops" };

export default async function AuditPage() {
  await requireRole(["admin"]);
  return <ComingSoon title="Audit log" description="Every change, who made it and when." arrives="WP-19" />;
}
