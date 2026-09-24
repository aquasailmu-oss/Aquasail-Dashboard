import { FileSpreadsheetIcon } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireRole } from "@/lib/auth";
import { parseRegisterFilters } from "@/lib/register";

export const metadata: Metadata = { title: "Export · AquaSail Ops" };

/** A quick way to the Excel export for a date range; the Bookings screen exports any filtered view. */
export default async function ExportPage() {
  await requireRole(["admin", "accountant"]);
  const { from, to } = parseRegisterFilters({});
  return (
    <>
      <PageHeader
        title="Export"
        description="Bookings for a date range as an Excel workbook: one sheet of bookings, one of lines."
      />
      <Card className="max-w-xl">
        <CardContent className="pt-6">
          <form action="/bookings/export" method="get" className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="from">From</Label>
                <Input id="from" name="from" type="date" defaultValue={from} required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="to">To</Label>
                <Input id="to" name="to" type="date" defaultValue={to} required />
              </div>
            </div>
            <Button type="submit" size="lg">
              <FileSpreadsheetIcon /> Download Excel
            </Button>
            <p className="text-muted-foreground text-sm">
              For a narrower export (one operator, unpaid bookings, and so on), filter the Bookings screen and export
              from there.
            </p>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
