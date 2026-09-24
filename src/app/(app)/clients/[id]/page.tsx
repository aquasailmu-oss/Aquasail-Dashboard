import { PencilIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddNoteForm } from "@/components/clients/add-note-form";
import { BookingStatusBadge } from "@/components/shared/booking-status-badge";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth";
import { formatDateShort } from "@/lib/dates";
import { cents, formatRs } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Client · AquaSail Ops" };

type Item = { packages: { name: string } | null; activities: { name: string } | null };

/** "Island Explorer, Parasailing": what the booking was for, each name once. */
function summary(items: Item[]): string {
  return [...new Set(items.map((i) => i.packages?.name ?? i.activities?.name).filter(Boolean))].join(", ");
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="font-semibold break-words">{children || <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(["admin", "accountant", "receptionist"]);
  const { id } = await params;
  const canEdit = user.role !== "accountant";

  const supabase = await createClient();
  const [{ data: client }, { data: bookings }] = await Promise.all([
    supabase.from("clients").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("bookings")
      .select(
        "id, reference, service_date, status, charged_total_cents, booking_items(packages(name), activities(name))",
      )
      .eq("client_id", id)
      .order("service_date", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);
  if (!client) notFound();

  return (
    <>
      <PageHeader
        title={`${client.first_name} ${client.last_name}`}
        description={`Client since ${formatDateShort(new Date(client.created_at))}`}
        actions={
          canEdit && (
            <Button asChild variant="outline">
              <Link href={`/clients/${client.id}/edit`}>
                <PencilIcon />
                Edit details
              </Link>
            </Button>
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Contact</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4">
              <Detail label="Phone">{formatPhone(client.phone_e164)}</Detail>
              <Detail label="Email">{client.email}</Detail>
              <Detail label="Country">{client.country}</Detail>
            </dl>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {client.notes ? (
              <p className="whitespace-pre-line">{client.notes}</p>
            ) : (
              <p className="text-muted-foreground">No notes yet.</p>
            )}
            {canEdit && <AddNoteForm clientId={client.id} />}
          </CardContent>
        </Card>
      </div>
      <h2 className="font-display mt-8 mb-3 text-xl font-semibold">Booking history</h2>
      {!bookings?.length ? (
        <Card className="text-muted-foreground p-8 text-center">No bookings yet.</Card>
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Booked</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bookings.map((b) => (
                <TableRow
                  key={b.id}
                  className={b.status === "cancelled" ? "text-muted-foreground line-through" : undefined}
                >
                  <TableCell className="font-mono whitespace-nowrap">{b.reference}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDateShort(b.service_date)}</TableCell>
                  <TableCell>{summary(b.booking_items)}</TableCell>
                  <TableCell className="text-right whitespace-nowrap tabular-nums">
                    {formatRs(cents(b.charged_total_cents))}
                  </TableCell>
                  <TableCell>
                    <BookingStatusBadge status={b.status} />
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
