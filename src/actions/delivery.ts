"use server";

import { z } from "zod";
import { authorize } from "@/lib/auth";
import { friendlyDbError } from "@/lib/db-errors";
import { sendEmail } from "@/lib/email";
import { ticketEmailHtml, ticketEmailSubject, ticketEmailText } from "@/lib/email-template";
import { requestOrigin } from "@/lib/origin";
import { qrDataUrl } from "@/lib/qr";
import { ticketUrl } from "@/lib/qr";
import { fail, ok, type Result } from "@/lib/result";
import { createClient } from "@/lib/supabase/server";
import { getTicket } from "@/lib/tickets";

const sendSchema = z.object({
  bookingId: z.uuid(),
  resend: z.boolean().default(false),
});

/**
 * Sends (or resends) a ticket confirmation email. The flow:
 * 1. Load the ticket and the booking's client email.
 * 2. Write a 'queued' message_log row BEFORE calling the provider.
 * 3. Call Resend with the HTML + plain text + PDF attachment.
 * 4. Update the log row with 'sent' or 'failed'.
 * Never throws — a failed email leaves a logged row and a visible failure.
 */
export async function sendTicketEmail(
  input: z.input<typeof sendSchema>,
): Promise<Result<{ logId: string }>> {
  const auth = await authorize(["admin", "receptionist"]);
  if (!auth.ok) return auth;

  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid booking.");
  const { bookingId, resend: isResend } = parsed.data;

  const supabase = await createClient();

  const { data: booking } = await supabase
    .from("bookings")
    .select("id, reference, status, clients(email), tickets(id, token, revoked_at)")
    .eq("id", bookingId)
    .maybeSingle();

  if (!booking) return fail("Booking not found.");
  if (booking.status === "cancelled") return fail("This booking is cancelled.");

  const email = booking.clients?.email;
  if (!email) return fail("No email address on this booking.");

  const ticket = booking.tickets?.find((t) => !t.revoked_at);
  if (!ticket) return fail("This booking has no active ticket.");

  if (isResend) {
    const { data: existing } = await supabase
      .from("message_log")
      .select("id, status, sent_at")
      .eq("booking_id", bookingId)
      .eq("channel", "email")
      .eq("status", "sent")
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) {
      const sentAt = existing.sent_at
        ? new Date(existing.sent_at).toLocaleTimeString("en-MU", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "Indian/Mauritius",
          })
        : "";
      return fail(`This was delivered at ${sentAt}. Send again?`);
    }
  }

  const t = await getTicket(ticket.token);
  if (!t) return fail("The ticket could not be loaded.");

  const origin = await requestOrigin();
  const qrUrl = ticketUrl(origin, ticket.token);
  const dataUrl = await qrDataUrl(qrUrl);

  const { data: logId, error: logError } = await supabase.rpc("log_delivery_attempt", {
    p_booking_id: bookingId,
    p_ticket_id: ticket.id,
    p_channel: "email",
    p_template: "ticket_confirmation",
    p_to_address: email,
    p_provider: "resend",
  });
  if (logError) return fail(friendlyDbError(logError, "The email could not be queued."));

  let pdfBuffer: Buffer | null = null;
  try {
    const { cookies } = await import("next/headers");
    const jar = await cookies();
    const pdfUrl = `${origin}/tickets/${ticket.token}/pdf`;
    const pdfRes = await fetch(pdfUrl, {
      headers: {
        cookie: jar.getAll().map((c: { name: string; value: string }) => `${c.name}=${c.value}`).join("; "),
      },
    });
    if (pdfRes.ok) {
      pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
    }
  } catch {
    // PDF attachment is best-effort; the email still goes out
  }

  try {
    const result = await sendEmail({
      to: email,
      subject: ticketEmailSubject(t),
      html: ticketEmailHtml(t, qrUrl, dataUrl),
      text: ticketEmailText(t, qrUrl),
      attachments: pdfBuffer
        ? [{ filename: `Ticket_${booking.reference}.pdf`, content: pdfBuffer }]
        : undefined,
    });

    await supabase.rpc("update_delivery_status", {
      p_log_id: logId,
      p_status: "sent",
      p_provider_message_id: result.id,
    });

    return ok({ logId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await supabase.rpc("update_delivery_status", {
      p_log_id: logId,
      p_status: "failed",
      p_error_code: "provider_error",
      p_error_detail: message.slice(0, 500),
    });
    return fail(`Email failed: ${message}`);
  }
}
