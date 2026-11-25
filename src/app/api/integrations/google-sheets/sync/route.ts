import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { cents } from "@/lib/money";
import { bookingShares } from "@/lib/settlement";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  appendBookingSheetRow,
  findBookingSheetRow,
  isGoogleSheetsSyncConfigured,
  updateBookingSheetRow,
} from "@/lib/google-sheets";

export const dynamic = "force-dynamic";

type QueueJob = { booking_id: string; requested_at: string };
type SyncBooking = {
  id: string;
  reference: string;
  service_date: string;
  status: string;
  operator_name: string | null;
  hotel_name: string | null;
  client_id: string;
  client_name: string;
  client_phone: string | null;
  payer: string;
  charged_total_cents: number;
  paid_cents: number;
  balance_cents: number;
  source_type: string;
  people: number;
};
type SyncClient = {
  id: string;
  first_name: string;
  last_name: string;
  phone_e164: string | null;
  email: string | null;
  country: string | null;
};
type SyncBookingState = { id: string; tracks_settlement: boolean };
type SyncItem = {
  booking_id: string;
  settlement_manual: boolean;
  settlement_aquasail_cents: number | null;
  quantity: number;
  unit_charged_cents: number;
  discount_cents: number;
  participant_type: string;
  sort_order: number;
  packages: { name: string } | null;
  activities: { name: string } | null;
};
type SyncParticipant = { booking_id: string; participant_type: string; count: number };
type SyncPayment = { booking_id: string; amount_cents: number };

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || supplied.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(secret));
}

function rs(amount: number): number {
  return Number((cents(amount) / 100).toFixed(2));
}

function lineSummary(items: SyncItem[]): string {
  return [...items]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((item) => `${item.packages?.name ?? item.activities?.name ?? "Booking item"} — ${item.participant_type} × ${item.quantity}`)
    .join("; ");
}

export async function GET(request: Request) {
  if (!isGoogleSheetsSyncConfigured()) return NextResponse.json({ ok: true, sync: "not_configured" });
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const admin = createAdminClient();
  const { data: claimed, error: claimError } = await admin.rpc("claim_booking_sheet_sync_jobs", { p_limit: 25 });
  if (claimError) return NextResponse.json({ error: "The sync queue could not be read." }, { status: 500 });
  const jobs = (claimed ?? []) as QueueJob[];
  if (jobs.length === 0) return NextResponse.json({ ok: true, processed: 0, failed: 0 });

  const ids = jobs.map((job) => job.booking_id);
  const [bookingResult, stateResult, itemResult, participantResult, paymentResult] = await Promise.all([
    admin
      .from("booking_register")
      .select("id, reference, service_date, status, operator_name, hotel_name, client_id, client_name, client_phone, payer, charged_total_cents, paid_cents, balance_cents, source_type, people")
      .in("id", ids)
      .overrideTypes<SyncBooking[], { merge: false }>(),
    admin.from("bookings").select("id, tracks_settlement").in("id", ids).overrideTypes<SyncBookingState[], { merge: false }>(),
    admin
      .from("booking_items")
      .select("booking_id, settlement_manual, settlement_aquasail_cents, quantity, unit_charged_cents, discount_cents, participant_type, sort_order, packages(name), activities(name)")
      .in("booking_id", ids)
      .overrideTypes<SyncItem[], { merge: false }>(),
    admin
      .from("booking_participants")
      .select("booking_id, participant_type, count")
      .in("booking_id", ids)
      .overrideTypes<SyncParticipant[], { merge: false }>(),
    admin.from("payments").select("booking_id, amount_cents").in("booking_id", ids).overrideTypes<SyncPayment[], { merge: false }>(),
  ]);

  const queryError = bookingResult.error || stateResult.error || itemResult.error || participantResult.error || paymentResult.error;
  if (queryError) {
    await admin
      .from("booking_sheet_sync_queue")
      .update({ locked_until: null, last_error: "Booking data could not be loaded for sync." })
      .in("booking_id", ids);
    return NextResponse.json({ error: "Booking data could not be loaded for sync." }, { status: 500 });
  }

  const bookingById = new Map((bookingResult.data ?? []).map((booking) => [booking.id, booking]));
  const stateById = new Map((stateResult.data ?? []).map((state) => [state.id, state]));
  const itemsById = new Map<string, SyncItem[]>();
  const participantCounts = new Map<string, Record<string, number>>();
  const paidById = new Map<string, number>();
  for (const item of itemResult.data ?? []) itemsById.set(item.booking_id, [...(itemsById.get(item.booking_id) ?? []), item]);
  for (const participant of participantResult.data ?? []) {
    const counts = participantCounts.get(participant.booking_id) ?? {};
    counts[participant.participant_type] = participant.count;
    participantCounts.set(participant.booking_id, counts);
  }
  for (const payment of paymentResult.data ?? []) {
    paidById.set(payment.booking_id, (paidById.get(payment.booking_id) ?? 0) + payment.amount_cents);
  }

  const missingClientIds = [...new Set((bookingResult.data ?? []).map((booking) => booking.client_id).filter(Boolean))];
  const clientResult = missingClientIds.length
    ? await admin
        .from("clients")
        .select("id, first_name, last_name, phone_e164, email, country")
        .in("id", missingClientIds)
        .overrideTypes<SyncClient[], { merge: false }>()
    : { data: [] as SyncClient[], error: null };
  if (clientResult.error) {
    await admin
      .from("booking_sheet_sync_queue")
      .update({ locked_until: null, last_error: "Customer details could not be loaded for sync." })
      .in("booking_id", ids);
    return NextResponse.json({ error: "Customer details could not be loaded for sync." }, { status: 500 });
  }
  const clientsById = new Map((clientResult.data ?? []).map((client) => [client.id, client]));

  let processed = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      const booking = bookingById.get(job.booking_id);
      if (!booking) {
        await admin
          .from("booking_sheet_sync_queue")
          .delete()
          .eq("booking_id", job.booking_id)
          .eq("requested_at", job.requested_at);
        processed++;
        continue;
      }
      const client = clientsById.get(booking.client_id);
      const items = itemsById.get(booking.id) ?? [];
      const participants = participantCounts.get(booking.id) ?? {};
      const isOperatorAccountPrebook = booking.payer === "operator";
      let aquasailShare = 0;
      let operatorShare = 0;
      let sharesComplete = Boolean(stateById.get(booking.id)?.tracks_settlement) && booking.status !== "cancelled";
      if (!isOperatorAccountPrebook && sharesComplete) {
        for (const item of items) {
          const shares = bookingShares(
            item.unit_charged_cents * item.quantity - item.discount_cents,
            item.settlement_manual,
            item.settlement_aquasail_cents,
          );
          if (shares.aquasail === null || shares.operator === null) {
            sharesComplete = false;
            break;
          }
          aquasailShare += shares.aquasail;
          operatorShare += shares.operator;
        }
      } else {
        sharesComplete = false;
      }

      const row = [
        booking.id,
        booking.reference,
        booking.service_date,
        booking.status,
        booking.operator_name ?? "",
        booking.hotel_name ?? "",
        client ? `${client.first_name} ${client.last_name}`.trim() : booking.client_name,
        client?.phone_e164 ?? booking.client_phone ?? "",
        client?.email ?? "",
        client?.country ?? "",
        lineSummary(items),
        participants.adult ?? 0,
        participants.child ?? 0,
        participants.infant ?? 0,
        booking.payer === "operator" ? "Operator account" : "Client at reception",
        rs(booking.charged_total_cents),
        rs(paidById.get(booking.id) ?? booking.paid_cents),
        rs(booking.balance_cents),
        !isOperatorAccountPrebook && sharesComplete ? rs(aquasailShare) : "",
        !isOperatorAccountPrebook && sharesComplete ? rs(operatorShare) : "",
      ];

      const existingRow = await findBookingSheetRow(booking.id);
      if (existingRow === null) await appendBookingSheetRow(row);
      else await updateBookingSheetRow(existingRow, row, isOperatorAccountPrebook);

      const { error: deleteError } = await admin
        .from("booking_sheet_sync_queue")
        .delete()
        .eq("booking_id", job.booking_id)
        .eq("requested_at", job.requested_at);
      if (deleteError) throw new Error("The completed sync could not be acknowledged.");
      processed++;
    } catch (error) {
      failed++;
      const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown Google Sheets sync error.";
      await admin
        .from("booking_sheet_sync_queue")
        .update({ locked_until: null, last_error: message })
        .eq("booking_id", job.booking_id)
        .eq("requested_at", job.requested_at);
    }
  }

  return NextResponse.json({ ok: failed === 0, processed, failed });
}
