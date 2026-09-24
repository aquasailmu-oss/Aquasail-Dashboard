import type { Metadata } from "next";
import { ComingSoon } from "@/components/shell/coming-soon";
import { requireRole } from "@/lib/auth";

export const metadata: Metadata = { title: "Daily register · AquaSail Ops" };

export default async function RegisterPage() {
  await requireRole(["admin", "accountant", "receptionist"]);
  return <ComingSoon title="Daily register" description="The printable end-of-day sheet." arrives="WP-17b" />;
}
