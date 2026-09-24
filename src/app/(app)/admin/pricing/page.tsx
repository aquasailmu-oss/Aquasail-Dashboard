import type { Metadata } from "next";
import { ComingSoon } from "@/components/shell/coming-soon";
import { requireRole } from "@/lib/auth";

export const metadata: Metadata = { title: "Pricing · AquaSail Ops" };

export default async function PricingPage() {
  await requireRole(["admin"]);
  return <ComingSoon title="Pricing" description="Effective-dated prices and price history." arrives="WP-13" />;
}
