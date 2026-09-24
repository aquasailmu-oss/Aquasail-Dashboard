import type { Metadata } from "next";
import { ComingSoon } from "@/components/shell/coming-soon";
import { requireRole } from "@/lib/auth";

export const metadata: Metadata = { title: "Today · AquaSail Ops" };

export default async function TodayPage() {
  await requireRole(["admin", "accountant", "receptionist"]);
  return <ComingSoon title="Today" description="Today's bookings, cash and activity counts." arrives="WP-17" />;
}
