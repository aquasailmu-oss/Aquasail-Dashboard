import { FileSpreadsheetIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireRole } from "@/lib/auth";
import { businessDate } from "@/lib/dates";
import { parseRegisterFilters } from "@/lib/register";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Export · AquaSail Ops" };

/** A quick way to the Excel export for a date range; the Bookings screen exports any filtered view. */
export default async function ExportPage() {
  await requireRole(["admin", "accountant"]);
  const { from, to } = parseRegisterFilters({});
  const month = businessDate().slice(0, 7);
  const bookingRegisterId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
  const bookingRegisterUrl = bookingRegisterId
    ? `https://docs.google.com/spreadsheets/d/${bookingRegisterId}/edit`
    : null;
  const supabase = await createClient();
  const { data: operators } = await supabase
    .from("tour_operators")
    .select("id, name")
    .eq("is_active", true)
    .order("name");
  return (
    <>
      <PageHeader
        title="Reports & exports"
        description="Download reporting workbooks for a selected date range or operator."
      />
      <section className="bg-muted/30 mb-5 rounded-lg border p-4">
        <h2 className="font-semibold">Live Booking Register</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          This is the spreadsheet that receives live booking updates. The Excel files below are reports; don’t upload
          them as the live register.
        </p>
        {bookingRegisterUrl ? (
          <Link
            href={bookingRegisterUrl}
            target="_blank"
            rel="noreferrer"
            className="text-accent-foreground mt-2 inline-block font-medium underline"
          >
            Open Booking Register
          </Link>
        ) : (
          <p className="text-muted-foreground mt-2 text-sm">
            The register link is not configured for this environment.
          </p>
        )}
      </section>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="max-w-xl">
          <CardContent className="pt-6">
            <h2 className="font-display text-xl font-semibold">Date-range report</h2>
            <p className="text-muted-foreground mt-1 mb-5 text-sm">
              Summary, direct sales, cash, card, other payments, and attendance for the bookings in the selected range.
            </p>
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
                <FileSpreadsheetIcon /> Download report workbook
              </Button>
              <p className="text-muted-foreground text-sm">
                The filters on the Bookings screen also apply when you download from that page.
              </p>
            </form>
          </CardContent>
        </Card>
        <Card className="max-w-xl">
          <CardContent className="pt-6">
            <h2 className="font-display text-xl font-semibold">Monthly operator report</h2>
            <p className="text-muted-foreground mt-1 mb-5 text-sm">
              Summary, direct sales, cash, card, other payments, and attendance for the selected operator and service
              month.
            </p>
            <form action="/operator-statements/export" method="get" className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="operator_id">Tour operator</Label>
                <select
                  id="operator_id"
                  name="operator_id"
                  className="border-input bg-card min-h-11 rounded-md border px-3"
                  required
                  defaultValue=""
                >
                  <option value="" disabled>
                    Choose an operator
                  </option>
                  {(operators ?? []).map((operator) => (
                    <option key={operator.id} value={operator.id}>
                      {operator.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="month">Service month</Label>
                <Input id="month" name="month" type="month" defaultValue={month} required />
              </div>
              <Button type="submit" size="lg" disabled={!operators?.length}>
                <FileSpreadsheetIcon /> Download monthly report
              </Button>
              <p className="text-muted-foreground text-sm">
                Figures come from current booking, payment, and attendance records. Settlement fields are exported as
                saved by the app; this workbook does not add manual split or adjustment calculations.
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
