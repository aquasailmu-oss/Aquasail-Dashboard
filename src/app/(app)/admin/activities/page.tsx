import { PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { setActivityActive } from "@/actions/catalogue";
import { ActiveToggle } from "@/components/catalogue/active-toggle";
import { MoveButtons } from "@/components/catalogue/move-buttons";
import { PageHeader } from "@/components/shell/page-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Activities · AquaSail Ops" };

export default async function ActivitiesPage() {
  await requireRole(["admin"]);
  const supabase = await createClient();
  const { data: activities, error } = await supabase
    .from("activities")
    .select(
      "id, code, name, is_redeemable, default_duration_minutes, is_active, package_activities(packages(name, is_active))",
    )
    .order("sort_order")
    .order("name");

  return (
    <>
      <PageHeader
        title="Activities"
        description="The things AquaSail sells. Packages are built from these. Nothing is deleted: deactivate instead."
        actions={
          <Button asChild>
            <Link href="/admin/activities/new">
              <PlusIcon />
              New activity
            </Link>
          </Button>
        }
      />
      {error ? (
        <Alert variant="destructive">Activities could not be loaded. Refresh the page to try again.</Alert>
      ) : activities.length === 0 ? (
        <Card className="text-muted-foreground p-10 text-center">No activities yet. Add the first one.</Card>
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Island redeems</TableHead>
                <TableHead>In active packages</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activities.map((a, i) => {
                const inPackages = a.package_activities
                  .map((pa) => pa.packages)
                  .filter((p) => p?.is_active)
                  .map((p) => p?.name ?? "");
                return (
                  <TableRow key={a.id} className={a.is_active ? undefined : "text-muted-foreground"}>
                    <TableCell>
                      <MoveButtons id={a.id} name={a.name} first={i === 0} last={i === activities.length - 1} />
                    </TableCell>
                    <TableCell className="font-mono">{a.code}</TableCell>
                    <TableCell className="font-semibold">{a.name}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {a.default_duration_minutes ? `${a.default_duration_minutes} min` : "—"}
                    </TableCell>
                    <TableCell>{a.is_redeemable ? "Yes" : "No"}</TableCell>
                    <TableCell>
                      {inPackages.length === 0 ? (
                        <span className="text-muted-foreground">None</span>
                      ) : (
                        <span title={inPackages.join(", ")}>{inPackages.length}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={a.is_active ? "success" : "secondary"}>
                        {a.is_active ? "Active" : "Deactivated"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/admin/activities/${a.id}`} aria-label={`Edit ${a.name}`}>
                            Edit
                          </Link>
                        </Button>
                        <ActiveToggle
                          id={a.id}
                          name={a.name}
                          isActive={a.is_active}
                          action={setActivityActive}
                          affected={inPackages}
                          affectedLabel={`${a.name} is part of these active packages. They stay on sale, but reception cannot add ${a.name} on its own, and it cannot be added to other packages.`}
                        />
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
