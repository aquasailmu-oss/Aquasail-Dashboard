import "server-only";
import { getSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";

/**
 * Everything printed on a ticket, loaded once for both the print page and
 * the PDF, so the two can never say different things. No prices: a ticket
 * is handed to the customer and later shown to island staff (V2).
 */
export type TicketData = {
  token: string;
  bookingId: string;
  reference: string;
  cancelled: boolean;
  printedCount: number;
  companyName: string;
  companyPhone: string;
  footer: string;
  logoPath: string;
  clientName: string;
  participants: string;
  serviceDate: string;
  departureTime: string | null;
  meetingPoint: string;
  boat: string | null;
  items: string[];
  entitlements: { name: string; quantity: number }[];
};

const TYPE = { adult: ["adult", "adults"], child: ["child", "children"], infant: ["infant", "infants"] } as const;

export async function getTicket(token: string): Promise<TicketData | null> {
  if (!/^[0-9a-f]{32}$/.test(token)) return null;
  const supabase = await createClient();
  const [{ data: t }, settings] = await Promise.all([
    supabase
      .from("tickets")
      .select(
        "token, printed_count, bookings(id, reference, status, service_date, departure_time, meeting_point, clients(first_name, last_name), resources(name), booking_participants(participant_type, count), booking_items(sort_order, packages(name), activities(name)), booking_activities(quantity, activities(name, sort_order)))",
      )
      .eq("token", token)
      .maybeSingle(),
    getSettings(),
  ]);
  const b = t?.bookings;
  if (!t || !b) return null;

  const order = ["adult", "child", "infant"] as const;
  const participants = order
    .map((type) => {
      const n = b.booking_participants.find((p) => p.participant_type === type)?.count ?? 0;
      return n > 0 ? `${n} ${TYPE[type][n === 1 ? 0 : 1]}` : null;
    })
    .filter(Boolean)
    .join(", ");

  const entitlements = new Map<string, { name: string; quantity: number; order: number }>();
  for (const e of b.booking_activities) {
    if (!e.activities) continue;
    const row = entitlements.get(e.activities.name) ?? {
      name: e.activities.name,
      quantity: 0,
      order: e.activities.sort_order,
    };
    row.quantity += e.quantity;
    entitlements.set(e.activities.name, row);
  }

  return {
    token: t.token,
    bookingId: b.id,
    reference: b.reference,
    cancelled: b.status === "cancelled",
    printedCount: t.printed_count,
    companyName: settings.company_name,
    companyPhone: settings.company_phone,
    footer: settings.ticket_footer_text,
    logoPath: settings.logo_path,
    clientName: `${b.clients?.first_name ?? ""} ${b.clients?.last_name ?? ""}`.trim(),
    participants,
    serviceDate: b.service_date,
    departureTime: b.departure_time,
    meetingPoint: b.meeting_point ?? settings.default_meeting_point,
    boat: b.resources?.name ?? null,
    items: [
      ...new Set(
        [...b.booking_items]
          .sort((x, y) => x.sort_order - y.sort_order)
          .map((i) => i.packages?.name ?? i.activities?.name ?? ""),
      ),
    ].filter(Boolean),
    entitlements: [...entitlements.values()]
      .sort((x, y) => x.order - y.order)
      .map(({ name, quantity }) => ({ name, quantity })),
  };
}
