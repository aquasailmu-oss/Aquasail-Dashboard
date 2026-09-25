import type { Metadata } from "next";
import { PrintButton } from "@/components/today/print-button";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth";
import { businessDate, formatDateLong, formatDateShort, parseDateInput } from "@/lib/dates";
import { cents, formatRs } from "@/lib/money";
import { formatRate } from "@/lib/operators";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Daily register · AquaSail Ops" };

type Register = {
  rows: { kind: "boat" | "activity"; label: string; pax: number; amount_cents: number }[];
  subtotal_pax: number;
  subtotal_cents: number;
  operators: {
    label: string;
    settlement_model: string;
    commission_rate: number | null;
    pax: number;
    amount_cents: number;
  }[];
  total_received_cents: number;
};

/**
 * The printable end-of-day sheet (CLAUDE.md adjustment, WP-17b). The
 * arithmetic is daily_register() in the database, so V3's reconciliation
 * uses the same figures.
 */
export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  await requireRole(["admin", "accountant", "receptionist"]);
  const { date: param } = await searchParams;
  const date = (param && parseDateInput(param)) || businessDate();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("daily_register", { p_date: date });
  if (error || !data)
    return <Alert variant="destructive">The register could not be loaded. Refresh the page to try again.</Alert>;
  const reg = data as unknown as Register; // shape fixed by daily_register()

  return (
    <div className="register-sheet">
      <style>{`
        @page { size: A4 portrait; margin: 12mm; }
        @media print {
          html, body { background: #fff !important; }
          .register-sheet { font-size: 12px; }
          .register-sheet th, .register-sheet td { padding-top: 3px; padding-bottom: 3px; height: auto; }
        }
      `}</style>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 print:hidden">
        <div>
          <h1 className="font-display text-3xl font-semibold">Daily register</h1>
          <p className="text-muted-foreground">
            End-of-day sheet: people and money received by vessel, activity and operator.
          </p>
        </div>
        <form className="flex items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="date">Date</Label>
            <Input id="date" name="date" type="date" defaultValue={date} className="w-44" />
          </div>
          <Button type="submit" variant="outline">
            Show
          </Button>
          <PrintButton />
        </form>
      </div>

      <article className="bg-card mx-auto flex max-w-3xl flex-col gap-6 rounded-lg border p-6 print:max-w-none print:gap-3 print:border-0 print:p-0">
        <header className="flex items-center gap-4 border-b-2 border-black pb-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- printed */}
          <img src="/aquasail-logo.svg" alt="AquaSail" className="h-8 w-auto" />
          <div>
            <div className="font-semibold">Daily activity and operator register</div>
            <div className="text-muted-foreground print:text-black">{formatDateLong(date)}</div>
          </div>
        </header>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Vessel / activity</TableHead>
              <TableHead className="text-center">PAX</TableHead>
              <TableHead className="text-right">Amount received</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reg.rows.map((r, i) => (
              <TableRow
                key={r.label}
                className={r.kind === "activity" && reg.rows[i - 1]?.kind === "boat" ? "border-t-2" : undefined}
              >
                <TableCell className={r.kind === "boat" ? "font-semibold" : undefined}>{r.label}</TableCell>
                <TableCell className="text-center tabular-nums">{r.pax}</TableCell>
                <TableCell className="text-right tabular-nums">{formatRs(cents(r.amount_cents))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-semibold">Subtotal</TableCell>
              <TableCell className="text-center font-semibold tabular-nums" data-testid="subtotal-pax">
                {reg.subtotal_pax}
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums" data-testid="subtotal-amount">
                {formatRs(cents(reg.subtotal_cents))}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tour operator</TableHead>
              <TableHead className="text-center">PAX</TableHead>
              <TableHead className="text-right">Amount received</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reg.operators.map((o) => (
              <TableRow key={o.label}>
                <TableCell>
                  {o.label}{" "}
                  <span className="text-muted-foreground text-sm print:text-black">
                    (
                    {o.settlement_model === "commission"
                      ? `${formatRate(o.commission_rate)} commission`
                      : o.settlement_model === "net_rate"
                        ? "net rate"
                        : "no special pricing"}
                    )
                  </span>
                </TableCell>
                <TableCell className="text-center tabular-nums">{o.pax}</TableCell>
                <TableCell className="text-right tabular-nums">{formatRs(cents(o.amount_cents))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="rounded-md border-2 border-black p-4">
          <div className="flex items-baseline justify-between">
            <span className="font-display text-xl font-semibold">Total received</span>
            <span className="font-display text-3xl font-semibold tabular-nums" data-testid="total-received">
              {formatRs(cents(reg.total_received_cents))}
            </span>
          </div>
          <p className="text-muted-foreground mt-2 text-sm print:text-black">
            Every payment on bookings for {formatDateShort(date)}, all methods, less corrections. This is the
            day&rsquo;s reconciliation figure. The operator table is a second view of the same bookings, not an
            addition. A boat booking&rsquo;s full value is counted on its vessel; other activities at their own price,
            scaled by discount and by what was paid.
          </p>
        </div>
      </article>
    </div>
  );
}
