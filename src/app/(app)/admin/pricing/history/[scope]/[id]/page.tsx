import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth";
import { addDays, businessDate, formatDateShort, formatDateTime } from "@/lib/dates";
import { cents, formatRs } from "@/lib/money";
import { formatRate } from "@/lib/operators";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Price history · AquaSail Ops" };

const TYPE = { adult: "Adult", child: "Child", infant: "Infant" } as const;

/**
 * Every price an item has ever had, oldest first, with who set it and when.
 * The accountant opens this when a past booking's price is questioned.
 */
export default async function PriceHistoryPage({ params }: { params: Promise<{ scope: string; id: string }> }) {
  const user = await requireRole(["admin", "accountant"]);
  const { scope, id } = await params;
  if (scope !== "activity" && scope !== "package") notFound();

  const supabase = await createClient();
  const [{ data: item }, { data: history, error }] = await Promise.all([
    scope === "activity"
      ? supabase.from("activities").select("name").eq("id", id).maybeSingle()
      : supabase.from("packages").select("name").eq("id", id).maybeSingle(),
    supabase.rpc("price_rule_history", scope === "activity" ? { p_activity_id: id } : { p_package_id: id }),
  ]);
  if (!item) notFound();
  const today = businessDate();

  return (
    <>
      <PageHeader
        title={`Price history: ${item.name}`}
        description="Every price, oldest first. A change closes the previous price the day before the new one starts."
        actions={
          user.role === "admin" && (
            <Button asChild variant="outline">
              <Link href="/admin/pricing">
                <ArrowLeftIcon />
                Pricing
              </Link>
            </Button>
          )
        }
      />
      {error ? (
        <Alert variant="destructive">The history could not be loaded. Refresh the page to try again.</Alert>
      ) : !history?.length ? (
        <Card className="text-muted-foreground p-10 text-center">No prices have ever been set for {item.name}.</Card>
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>From</TableHead>
                <TableHead>Until</TableHead>
                <TableHead>For</TableHead>
                <TableHead>Participant</TableHead>
                <TableHead className="text-right">Retail</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead className="text-right">Commission</TableHead>
                <TableHead>Set by</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((h) => {
                const current = h.effective_from <= today && (h.effective_to === null || h.effective_to > today);
                return (
                  <TableRow key={h.id} className={current ? "bg-success-surface/60" : undefined}>
                    <TableCell className="whitespace-nowrap">
                      {formatDateShort(h.effective_from)}
                      {current && (
                        <Badge variant="success" className="ml-2">
                          Now
                        </Badge>
                      )}
                      {h.effective_from > today && (
                        <Badge variant="info" className="ml-2">
                          Scheduled
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {h.effective_to ? formatDateShort(addDays(h.effective_to, -1)) : "—"}
                    </TableCell>
                    <TableCell>{h.audience === "walk_in" ? "Walk-in" : h.operator_name}</TableCell>
                    <TableCell>{TYPE[h.participant_type]}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {formatRs(cents(h.retail_cents))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {h.net_cents === null ? "—" : formatRs(cents(h.net_cents))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {h.commission_rate === null ? "—" : formatRate(h.commission_rate)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {h.set_by ?? "Setup"}
                      <div className="text-muted-foreground text-sm">{formatDateTime(h.set_at)}</div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
