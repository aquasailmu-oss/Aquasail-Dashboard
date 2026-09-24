import { PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { setOperatorActive } from "@/actions/operators";
import { ActiveToggle } from "@/components/catalogue/active-toggle";
import { PageHeader } from "@/components/shell/page-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth";
import { addDays, businessDate } from "@/lib/dates";
import { PAYERS, SETTLEMENT_MODELS, formatRate, type Payer, type SettlementModel } from "@/lib/operators";
import { formatPhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Operators · AquaSail Ops" };

export default async function OperatorsPage() {
  await requireRole(["admin"]);
  const supabase = await createClient();
  const since = addDays(businessDate(), -30);
  const [{ data: operators, error }, { data: recent }] = await Promise.all([
    supabase.from("tour_operators").select("*").order("is_active", { ascending: false }).order("name"),
    supabase
      .from("bookings")
      .select("operator_id")
      .not("operator_id", "is", null)
      .gte("service_date", since)
      .neq("status", "cancelled"),
  ]);
  const counts = new Map<string, number>();
  for (const b of recent ?? []) if (b.operator_id) counts.set(b.operator_id, (counts.get(b.operator_id) ?? 0) + 1);

  return (
    <>
      <PageHeader
        title="Tour operators"
        description="Hotels and agents who send customers, and how each one is settled."
        actions={
          <Button asChild>
            <Link href="/admin/operators/new">
              <PlusIcon />
              New operator
            </Link>
          </Button>
        }
      />
      {error ? (
        <Alert variant="destructive">Operators could not be loaded. Refresh the page to try again.</Alert>
      ) : operators.length === 0 ? (
        <Card className="text-muted-foreground p-10 text-center">No operators yet.</Card>
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Settlement</TableHead>
                <TableHead>Who pays</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead className="text-right">Bookings, last 30 days</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {operators.map((o) => (
                <TableRow key={o.id} className={o.is_active ? undefined : "text-muted-foreground"}>
                  <TableCell className="font-mono">{o.code}</TableCell>
                  <TableCell>
                    <Link
                      href={`/admin/operators/${o.id}`}
                      className="text-accent-foreground inline-flex min-h-11 items-center font-semibold hover:underline"
                    >
                      {o.name}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {SETTLEMENT_MODELS[o.settlement_model as SettlementModel].label}
                    {o.settlement_model === "commission" && ` ${formatRate(o.default_commission_rate)}`}
                  </TableCell>
                  <TableCell>
                    <Badge variant={o.payer === "operator" ? "destructive" : "secondary"}>
                      {PAYERS[o.payer as Payer].short}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div>{o.contact_name}</div>
                    <div className="text-muted-foreground text-sm whitespace-nowrap">
                      {formatPhone(o.contact_phone)}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{counts.get(o.id) ?? 0}</TableCell>
                  <TableCell>
                    <Badge variant={o.is_active ? "success" : "secondary"}>
                      {o.is_active ? "Active" : "Deactivated"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/admin/operators/${o.id}/edit`} aria-label={`Edit ${o.name}`}>
                          Edit
                        </Link>
                      </Button>
                      <ActiveToggle id={o.id} name={o.name} isActive={o.is_active} action={setOperatorActive} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
