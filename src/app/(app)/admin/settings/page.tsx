import type { Metadata } from "next";
import { ComingSoon } from "@/components/shell/coming-soon";
import { requireRole } from "@/lib/auth";

export const metadata: Metadata = { title: "Settings · AquaSail Ops" };

export default async function SettingsPage() {
  await requireRole(["admin"]);
  return (
    <ComingSoon title="Settings" description="Company details, ticket text and discount limits." arrives="WP-09" />
  );
}
