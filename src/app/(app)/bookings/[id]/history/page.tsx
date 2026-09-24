import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AuditEntry } from "@/components/audit/audit-entry";
import { PageHeader } from "@/components/shell/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { resolveAuditNames, type AuditRow } from "@/lib/audit-server";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Booking history · AquaSail Ops" };

/** The booking's story, oldest first: created by, priced at, paid, then every change. */
export default async function BookingHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["admin", "accountant"]);
  const { id } = await params;
  const supabase = await createClient();
  const { data: booking } = await supabase.from("bookings").select("id, reference").eq("id", id).maybeSingle();
  if (!booking) notFound();

  const { data, error } = await supabase
    .from("audit_logs")
    .select("id, table_name, record_id, action, actor_id, actor_role, changed_at, old_data, new_data")
    .or(`and(table_name.eq.bookings,record_id.eq.${id}),new_data->>booking_id.eq.${id},old_data->>booking_id.eq.${id}`)
    .in("table_name", ["bookings", "booking_items", "booking_participants", "payments", "tickets"])
    .order("changed_at")
    .order("id")
    .overrideTypes<AuditRow[], { merge: false }>();
  if (error)
    return <Alert variant="destructive">The history could not be loaded. Refresh the page to try again.</Alert>;
  const names = await resolveAuditNames(supabase, data);

  return (
    <>
      <PageHeader
        title={`History of ${booking.reference}`}
        description="Every change to this booking, its lines, payments and ticket, oldest first. Nothing here can be edited or deleted."
        actions={
          <Button asChild variant="outline">
            <Link href={`/bookings/${booking.id}`}>Back to the booking</Link>
          </Button>
        }
      />
      <Card>
        {data.map((r) => (
          <AuditEntry
            key={r.id}
            table={r.table_name}
            action={r.action}
            oldData={r.old_data}
            newData={r.new_data}
            changedAt={r.changed_at}
            actor={names.actor(r)}
            actorRole={r.actor_role}
            names={names.names(r)}
          />
        ))}
      </Card>
    </>
  );
}
