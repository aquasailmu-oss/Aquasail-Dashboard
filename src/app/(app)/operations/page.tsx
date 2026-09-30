import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { businessDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { OperationsView } from "@/components/operations/operations-view";

export const metadata: Metadata = { title: "Operations · AquaSail Ops" };

export default async function OperationsPage() {
  await requireRole(["admin", "accountant", "receptionist", "activity_supervisor"]);
  const today = businessDate();
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("booking_activities")
    .select(
      "id, quantity, activities!inner(name, sort_order), bookings!inner(id, reference, service_date, status, departure_time, checked_in_at, clients(first_name, last_name), booking_participants(participant_type, count))",
    )
    .eq("bookings.service_date", today)
    .neq("bookings.status", "cancelled");

  type Row = NonNullable<typeof rows>[number];

  const groups = new Map<
    string,
    {
      time: string | null;
      activity: string;
      activityOrder: number;
      totalEntitled: number;
      bookings: Array<{
        bookingId: string;
        reference: string;
        clientName: string;
        people: number;
        checkedIn: boolean;
        entitled: number;
      }>;
    }
  >();

  for (const r of rows ?? []) {
    const b = r.bookings as Row["bookings"];
    const a = r.activities as NonNullable<Row["activities"]>;
    const key = `${b.departure_time ?? "none"}::${a.name}`;
    const group = groups.get(key) ?? {
      time: b.departure_time,
      activity: a.name,
      activityOrder: a.sort_order,
      totalEntitled: 0,
      bookings: [],
    };
    group.totalEntitled += r.quantity;
    const pax =
      (b.booking_participants as Array<{ participant_type: string; count: number }>)?.reduce(
        (s, p) => s + p.count,
        0,
      ) ?? 0;
    if (!group.bookings.find((x) => x.bookingId === (b as { id: string }).id)) {
      group.bookings.push({
        bookingId: (b as { id: string }).id,
        reference: b.reference,
        clientName: `${(b.clients as { first_name: string; last_name: string })?.first_name ?? ""} ${(b.clients as { first_name: string; last_name: string })?.last_name ?? ""}`.trim(),
        people: pax,
        checkedIn: !!b.checked_in_at,
        entitled: r.quantity,
      });
    }
    groups.set(key, group);
  }

  const sorted = [...groups.values()].sort((a, b) => {
    if (a.time && b.time) return a.time.localeCompare(b.time) || a.activityOrder - b.activityOrder;
    if (a.time) return -1;
    if (b.time) return 1;
    return a.activityOrder - b.activityOrder;
  });

  const data = sorted.map((g) => ({
    time: g.time,
    activity: g.activity,
    totalEntitled: g.totalEntitled,
    checkedIn: g.bookings.filter((b) => b.checkedIn).length,
    pending: g.bookings.filter((b) => !b.checkedIn).length,
    bookings: g.bookings,
  }));

  return <OperationsView date={today} groups={data} />;
}
