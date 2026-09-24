import type { Metadata } from "next";
import { ComingSoon } from "@/components/shell/coming-soon";
import { requireRole } from "@/lib/auth";

export const metadata: Metadata = { title: "Bookings · AquaSail Ops" };

export default async function BookingsPage() {
  await requireRole(["admin", "accountant", "receptionist"]);
  return <ComingSoon title="Bookings" description="Search and filter every booking." arrives="WP-17" />;
}
