import type { Metadata } from "next";
import { ComingSoon } from "@/components/shell/coming-soon";
import { requireRole } from "@/lib/auth";

export const metadata: Metadata = { title: "New booking · AquaSail Ops" };

export default async function NewBookingPage() {
  await requireRole(["admin", "receptionist"]);
  return (
    <ComingSoon title="New booking" description="Create a booking for a walk-in or operator guest." arrives="WP-15" />
  );
}
