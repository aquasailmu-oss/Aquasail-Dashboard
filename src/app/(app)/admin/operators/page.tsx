import type { Metadata } from "next";
import { ComingSoon } from "@/components/shell/coming-soon";
import { requireRole } from "@/lib/auth";

export const metadata: Metadata = { title: "Operators · AquaSail Ops" };

export default async function OperatorsPage() {
  await requireRole(["admin"]);
  return <ComingSoon title="Operators" description="Tour operators and how they settle." arrives="WP-12" />;
}
