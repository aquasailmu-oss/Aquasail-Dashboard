"use client";

import { useState } from "react";
import Link from "next/link";
import { MailIcon, PrinterIcon, RefreshCwIcon } from "lucide-react";
import { sendTicketEmail } from "@/actions/delivery";
import { ReissueTicketDialog } from "@/components/booking/booking-dialogs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/dates";

type TicketInfo = {
  id: string;
  token: string;
  printedCount: number;
  issuedAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
  revokeReason: string | null;
};

type DeliveryLog = {
  id: string;
  channel: string;
  status: string;
  toAddress: string | null;
  errorCode: string | null;
  errorDetail: string | null;
  attempt: number;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  createdAt: string;
};

export function TicketPanel({
  bookingId,
  cancelled,
  canWrite,
  tickets,
  state,
  clientEmail,
  clientPhone: _clientPhone,
  deliveryLogs,
}: {
  bookingId: string;
  cancelled: boolean;
  canWrite: boolean;
  tickets: TicketInfo[];
  state: string;
  clientEmail: string | null;
  clientPhone: string | null;
  deliveryLogs: DeliveryLog[];
}) {
  const liveTicket = tickets.find((t) => !t.revokedAt);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; message: string } | null>(null);

  const emailLogs = deliveryLogs.filter((l) => l.channel === "email");
  const lastEmailSent = emailLogs.find((l) => l.status === "sent" || l.status === "delivered" || l.status === "read");

  const canSendEmail = canWrite && !cancelled && liveTicket && !!clientEmail;
  const emailDisabledReason = !clientEmail
    ? "No email address on this booking"
    : cancelled
      ? "Booking is cancelled"
      : !liveTicket
        ? "No active ticket"
        : null;

  async function handleSendEmail() {
    if (lastEmailSent) {
      const time = lastEmailSent.sentAt
        ? new Date(lastEmailSent.sentAt).toLocaleTimeString("en-MU", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "Indian/Mauritius",
          })
        : "";
      if (!window.confirm(`This was delivered at ${time}. Send again?`)) return;
    }
    setSending(true);
    setSendResult(null);
    const res = await sendTicketEmail({ bookingId, resend: !!lastEmailSent });
    setSending(false);
    if (res.ok) {
      setSendResult({ ok: true, message: "Email sent." });
    } else {
      if (res.error.includes("Send again?")) {
        if (window.confirm(res.error)) {
          setSending(true);
          const retry = await sendTicketEmail({ bookingId, resend: false });
          setSending(false);
          setSendResult(
            retry.ok ? { ok: true, message: "Email sent." } : { ok: false, message: retry.error },
          );
        }
      } else {
        setSendResult({ ok: false, message: res.error });
      }
    }
  }

  return (
    <Card className="mt-6">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle>
          Ticket: <span data-testid="ticket-state">{state}</span>
        </CardTitle>
        <div className="flex flex-wrap gap-2">
          {liveTicket && !cancelled && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/tickets/${liveTicket.token}?print=1`}>
                <PrinterIcon className="mr-1 size-4" /> Print
                {liveTicket.printedCount > 0 && (
                  <span className="text-muted-foreground ml-1 text-sm">({liveTicket.printedCount})</span>
                )}
              </Link>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={!canSendEmail || sending}
            title={emailDisabledReason ?? undefined}
            onClick={handleSendEmail}
          >
            <MailIcon className="mr-1 size-4" />
            {sending ? "Sending…" : lastEmailSent ? "Resend email" : "Send email"}
          </Button>
          {canWrite && !cancelled && <ReissueTicketDialog bookingId={bookingId} />}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {sendResult && (
          <div
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${sendResult.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}
            role="status"
          >
            {sendResult.message}
          </div>
        )}

        <ol className="flex flex-col gap-2" aria-label="Ticket history">
          {tickets.map((t) => (
            <li key={t.id} className="flex flex-col border-b pb-2 last:border-b-0 last:pb-0">
              <span className={t.revokedAt ? "text-muted-foreground" : "font-semibold"}>
                {t.revokedAt ? "Replaced" : "Current"} ticket, issued {formatDateTime(t.issuedAt)}
                {!t.revokedAt && t.printedCount > 0 && ` · printed ${t.printedCount}×`}
              </span>
              {t.revokedAt && (
                <span className="text-muted-foreground text-sm">
                  {cancelled && t === tickets[0]
                    ? "Stopped working when the booking was cancelled."
                    : `Stopped working ${formatDateTime(t.revokedAt)} (${t.revokedBy ?? "—"}): ${t.revokeReason ?? ""}`}
                </span>
              )}
            </li>
          ))}
        </ol>

        {deliveryLogs.length > 0 && (
          <div>
            <h3 className="text-muted-foreground mb-2 text-sm font-semibold">Delivery history</h3>
            <ol className="flex flex-col gap-1.5" aria-label="Delivery history">
              {deliveryLogs.map((l) => (
                <li key={l.id} className="flex items-center gap-2 text-sm">
                  <DeliveryStatusBadge status={l.status} />
                  <span className="capitalize">{l.channel}</span>
                  {l.toAddress && (
                    <span className="text-muted-foreground truncate">{l.toAddress}</span>
                  )}
                  <span className="text-muted-foreground">
                    {l.status === "sent" && l.sentAt && `sent ${formatDateTime(l.sentAt)}`}
                    {l.status === "delivered" && l.deliveredAt && `delivered ${formatDateTime(l.deliveredAt)}`}
                    {l.status === "read" && l.readAt && `read ${formatDateTime(l.readAt)}`}
                    {l.status === "failed" && `failed: ${l.errorDetail ?? l.errorCode ?? "unknown"}`}
                    {l.status === "queued" && `queued ${formatDateTime(l.createdAt)}`}
                  </span>
                  {l.attempt > 1 && (
                    <span className="text-muted-foreground">
                      <RefreshCwIcon className="inline size-3" /> #{l.attempt}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DeliveryStatusBadge({ status }: { status: string }) {
  const variant =
    status === "delivered" || status === "read"
      ? "default"
      : status === "sent"
        ? "secondary"
        : status === "failed"
          ? "destructive"
          : "outline";
  return <Badge variant={variant}>{status}</Badge>;
}
