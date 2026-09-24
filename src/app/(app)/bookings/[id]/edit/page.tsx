import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AmendForm } from "@/components/booking/amend-form";
import { PageHeader } from "@/components/shell/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { requireRole } from "@/lib/auth";
import { businessDate, formatDateLong, formatTime } from "@/lib/dates";
import { cents } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Amend booking · AquaSail Ops" };

export default async function AmendBookingPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(["admin", "receptionist"]);
  const { id } = await params;
  const supabase = await createClient();
  const { data: b } = await supabase
    .from("bookings")
    .select(
      "id, reference, service_date, operator_id, departure_time, meeting_point, notes, resource_id, status, payer, charged_total_cents, discount_total_cents, booking_items(line_type, package_id, activity_id, discount_reason), booking_participants(participant_type, count), payments(amount_cents)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!b) notFound();

  const back = (
    <Button asChild variant="outline">
      <Link href={`/bookings/${b.id}`}>Back to the booking</Link>
    </Button>
  );
  if (b.status === "cancelled") {
    return (
      <>
        <PageHeader title={`Amend ${b.reference}`} actions={back} />
        <Alert>This booking is cancelled, so it cannot be amended. Create a new booking instead.</Alert>
      </>
    );
  }
  if (user.role === "receptionist" && b.service_date < businessDate()) {
    return (
      <>
        <PageHeader title={`Amend ${b.reference}`} actions={back} />
        <Alert>
          This booking&rsquo;s date ({formatDateLong(b.service_date)}) has passed, so only an admin can amend it. That
          protects days whose cash is already counted. Ask an admin, or record a payment correction on the booking.
        </Alert>
      </>
    );
  }

  const [packages, activities, boats] = await Promise.all([
    supabase
      .from("packages")
      .select("id, name, description, package_activities(is_optional, sort_order, activities(name, code))")
      .eq("is_active", true)
      .order("sort_order")
      .order("name"),
    supabase.from("activities").select("id, name, code").eq("is_active", true).order("sort_order").order("name"),
    supabase.from("resources").select("id, name, capacity").eq("is_active", true).order("sort_order").order("name"),
  ]);
  const count = (t: "adult" | "child" | "infant") =>
    b.booking_participants.find((p) => p.participant_type === t)?.count ?? 0;
  const unique = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))];

  return (
    <>
      <PageHeader
        title={`Amend ${b.reference}`}
        description={`${formatDateLong(b.service_date)}${b.departure_time ? ` · ${formatTime(b.departure_time)}` : ""}. The date and source cannot change here; cancel and rebook for that.`}
        actions={back}
      />
      <AmendForm
        booking={{
          id: b.id,
          reference: b.reference,
          service_date: b.service_date,
          operator_id: b.operator_id,
          departure_time: b.departure_time ? formatTime(b.departure_time) : "",
          meeting_point: b.meeting_point ?? "",
          notes: b.notes ?? "",
          resource_id: b.resource_id,
          charged_total: cents(b.charged_total_cents),
          paid: cents(b.payments.reduce((s, p) => s + p.amount_cents, 0)),
          payer: b.payer as "client" | "operator",
          discount_total: cents(b.discount_total_cents),
          discount_reason: b.booking_items.find((i) => i.discount_reason)?.discount_reason ?? "",
          people: b.booking_participants.reduce((s, p) => s + p.count, 0),
        }}
        initial={{
          packageIds: unique(b.booking_items.filter((i) => i.line_type === "package").map((i) => i.package_id)),
          activityIds: unique(b.booking_items.filter((i) => i.line_type === "activity").map((i) => i.activity_id)),
          participants: { adult: count("adult"), child: count("child"), infant: count("infant") },
        }}
        packages={(packages.data ?? []).map((p) => {
          const included = [...p.package_activities]
            .filter((pa) => !pa.is_optional)
            .sort((a, c) => a.sort_order - c.sort_order);
          return {
            id: p.id,
            name: p.name,
            description: p.description,
            includes: included.map((pa) => pa.activities?.name ?? ""),
            codes: included.map((pa) => pa.activities?.code ?? ""),
          };
        })}
        activities={activities.data ?? []}
        boats={boats.data ?? []}
      />
    </>
  );
}
