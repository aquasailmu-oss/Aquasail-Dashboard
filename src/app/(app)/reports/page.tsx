import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Reports · AquaSail Ops" };

export default async function ReportsPage() {
  await requireRole(["admin", "accountant"]);
  return (
    <div>
      <h1 className="font-display mb-6 text-3xl font-semibold">Reports</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link href="/reports/redemptions">
          <Card className="hover:border-primary transition-colors">
            <CardHeader>
              <CardTitle>Redemption Report</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-sm">
                Per activity, location, device and staff. Flagged redemptions and their resolution.
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
