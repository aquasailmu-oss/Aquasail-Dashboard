import type { Metadata } from "next";
import { ComingSoon } from "@/components/shell/coming-soon";
import { requireRole } from "@/lib/auth";

export const metadata: Metadata = { title: "Clients · AquaSail Ops" };

export default async function ClientsPage() {
  await requireRole(["admin", "accountant", "receptionist"]);
  return <ComingSoon title="Clients" description="Customer records and booking history." arrives="WP-10" />;
}
