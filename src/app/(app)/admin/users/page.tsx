import type { Metadata } from "next";
import { ComingSoon } from "@/components/shell/coming-soon";
import { requireRole } from "@/lib/auth";

export const metadata: Metadata = { title: "Users · AquaSail Ops" };

export default async function UsersPage() {
  await requireRole(["admin"]);
  return <ComingSoon title="Users" description="Staff accounts and roles." arrives="WP-09" />;
}
