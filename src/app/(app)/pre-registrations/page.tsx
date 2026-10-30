import { PlusIcon, SearchIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth";
import { formatDateShort } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Pre-registrations · AquaSail Ops" };

export default async function PreRegistrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; saved?: string | string[] }>;
}) {
  await requireRole(["admin", "receptionist"]);
  const params = await searchParams;
  const term = typeof params.q === "string" ? params.q.trim().toLocaleLowerCase() : "";
  const saved = typeof params.saved === "string" ? params.saved : null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("booking_pre_registrations")
    .select(
      "id, service_date, notes, created_at, clients(first_name, last_name, phone_e164, email), tour_operators(name)",
    )
    .eq("status", "open")
    .order("service_date")
    .order("created_at", { ascending: false })
    .limit(500);
  const rows = (data ?? []).filter((row) => {
    if (!term) return true;
    const name = `${row.clients?.first_name ?? ""} ${row.clients?.last_name ?? ""}`.toLocaleLowerCase();
    const contact = `${row.clients?.phone_e164 ?? ""} ${row.clients?.email ?? ""}`.toLocaleLowerCase();
    return name.includes(term) || contact.includes(term);
  });

  return (
    <>
      <PageHeader
        title="Pre-registrations"
        description="Save client details before their visit, then find them here and complete the booking on the day."
        actions={
          <Button asChild>
            <Link href="/pre-registrations/new">
              <PlusIcon /> Pre-register client
            </Link>
          </Button>
        }
      />
      {saved && (
        <Alert variant="success" className="mb-5">
          Pre-registration saved. Search for the client when they arrive to complete the booking.
        </Alert>
      )}
      {error ? (
        <Alert variant="destructive">
          Pre-registrations could not be loaded. Apply the database migration and refresh.
        </Alert>
      ) : (
        <>
          <form className="mb-5 flex max-w-xl items-end gap-2" method="get">
            <div className="flex flex-1 flex-col gap-2">
              <label className="text-sm font-medium" htmlFor="pre-registration-search">
                Search by client name or contact
              </label>
              <Input id="pre-registration-search" name="q" defaultValue={term} placeholder="Name, phone, or email" />
            </div>
            <Button type="submit" variant="outline">
              <SearchIcon /> Search
            </Button>
          </form>
          {rows.length === 0 ? (
            <Card className="text-muted-foreground p-10 text-center">
              {term ? "No open pre-registrations match that search." : "No open pre-registrations yet."}
            </Card>
          ) : (
            <Card className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead>Visit date</TableHead>
                    <TableHead>Tour operator</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Staff note</TableHead>
                    <TableHead>
                      <span className="sr-only">Action</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-semibold">
                        {row.clients?.first_name} {row.clients?.last_name}
                      </TableCell>
                      <TableCell>{formatDateShort(row.service_date)}</TableCell>
                      <TableCell>{row.tour_operators?.name}</TableCell>
                      <TableCell>
                        {[formatPhone(row.clients?.phone_e164), row.clients?.email].filter(Boolean).join(" · ") || "—"}
                      </TableCell>
                      <TableCell className="max-w-64 truncate">{row.notes || "—"}</TableCell>
                      <TableCell>
                        <Button asChild size="sm">
                          <Link href={`/bookings/new?pre_registration=${row.id}`}>Complete booking</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </>
      )}
    </>
  );
}
