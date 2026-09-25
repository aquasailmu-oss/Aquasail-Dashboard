import { PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { setPackageActive } from "@/actions/catalogue";
import { ActiveToggle } from "@/components/catalogue/active-toggle";
import { DuplicatePackageButton } from "@/components/catalogue/duplicate-package-button";
import { PageHeader } from "@/components/shell/page-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth";
import { walkInAdultPricesToday } from "@/lib/catalogue-prices";
import { cents, formatRs } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Packages · AquaSail Ops" };

export default async function PackagesPage() {
  await requireRole(["admin"]);
  const supabase = await createClient();
  const [{ data: packages, error }, prices] = await Promise.all([
    supabase
      .from("packages")
      .select(
        "id, code, name, pricing_mode, is_active, package_activities(activity_id, quantity_per_participant, is_optional, sort_order, activities(name))",
      )
      .order("is_active", { ascending: false })
      .order("sort_order")
      .order("name"),
    walkInAdultPricesToday(),
  ]);

  /** Today's walk-in adult price, or null when something is not priced. */
  function priceToday(p: NonNullable<typeof packages>[number]) {
    if (p.pricing_mode === "bundle") return prices.packages.get(p.id) ?? null;
    let total = 0;
    for (const pa of p.package_activities.filter((x) => !x.is_optional)) {
      const unit = prices.activities.get(pa.activity_id);
      if (unit === undefined) return null;
      total += unit * pa.quantity_per_participant;
    }
    return cents(total);
  }

  return (
    <>
      <PageHeader
        title="Packages"
        description="What reception sells as a set. Built from activities; priced as a bundle or as the sum of its activities."
        actions={
          <Button asChild>
            <Link href="/admin/packages/new">
              <PlusIcon />
              New package
            </Link>
          </Button>
        }
      />
      {error ? (
        <Alert variant="destructive">Packages could not be loaded. Refresh the page to try again.</Alert>
      ) : packages.length === 0 ? (
        <Card className="text-muted-foreground p-10 text-center">No packages yet.</Card>
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Priced as</TableHead>
                <TableHead>Includes</TableHead>
                <TableHead className="text-right">Walk-in adult today</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {packages.map((p) => {
                const price = priceToday(p);
                return (
                  <TableRow key={p.id} className={p.is_active ? undefined : "text-muted-foreground"}>
                    <TableCell className="font-mono">{p.code}</TableCell>
                    <TableCell className="font-semibold">{p.name}</TableCell>
                    <TableCell>{p.pricing_mode === "bundle" ? "Package price" : "Sum of activities"}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {[...p.package_activities]
                          .sort((a, b) => a.sort_order - b.sort_order)
                          .map((pa) => (
                            <Badge key={pa.activity_id} variant={pa.is_optional ? "outline" : "info"}>
                              {pa.quantity_per_participant > 1 && `${pa.quantity_per_participant}× `}
                              {pa.activities?.name}
                              {pa.is_optional && " (optional)"}
                            </Badge>
                          ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap tabular-nums">
                      {price === null ? <Badge variant="warning">Not set</Badge> : formatRs(price)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.is_active ? "success" : "secondary"}>
                        {p.is_active ? "On sale" : "Off sale"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/admin/packages/${p.id}`} aria-label={`Edit ${p.name}`}>
                            Edit
                          </Link>
                        </Button>
                        <DuplicatePackageButton id={p.id} name={p.name} />
                        <ActiveToggle id={p.id} name={p.name} isActive={p.is_active} action={setPackageActive} />
                      </div>
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
