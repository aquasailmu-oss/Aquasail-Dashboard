import "server-only";
import { formatDateLong, formatTime } from "@/lib/dates";
import type { TicketData } from "@/lib/tickets";

export function ticketEmailSubject(t: TicketData): string {
  return `Your booking is confirmed — ${t.reference}`;
}

export function ticketEmailText(t: TicketData, qrUrl: string): string {
  const lines: string[] = [];
  lines.push("YOUR BOOKING IS CONFIRMED");
  lines.push("");
  lines.push(t.clientName);
  lines.push(
    `${formatDateLong(t.serviceDate)}${t.departureTime ? ` · ${formatTime(t.departureTime)}` : ""}`,
  );
  lines.push(t.items.join(" + "));
  if (t.meetingPoint) lines.push(`Meeting point: ${t.meetingPoint}`);
  if (t.boat) lines.push(`Boat: ${t.boat}`);
  lines.push(`Booking: ${t.reference}`);
  lines.push("");
  lines.push(`View your ticket: ${qrUrl}`);
  lines.push("");
  lines.push("Please show this ticket when requested.");
  lines.push("");
  lines.push(`${t.companyName}${t.companyPhone ? ` · ${t.companyPhone}` : ""}`);
  return lines.join("\n");
}

export function ticketEmailHtml(t: TicketData, qrUrl: string, qrDataUrl: string): string {
  const date = `${formatDateLong(t.serviceDate)}${t.departureTime ? ` &middot; ${formatTime(t.departureTime)}` : ""}`;
  const items = esc(t.items.join(" + "));

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Booking Confirmed</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f5f5f5">
<tr><td align="center" style="padding:24px 16px">
<table width="560" cellpadding="0" cellspacing="0" role="presentation" style="background:#fff;border-radius:8px;overflow:hidden;max-width:560px;width:100%">
<tr><td style="background:#2c3792;padding:20px 24px;color:#fff;font-size:18px;font-weight:700">
${esc(t.companyName)}
</td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 16px;font-size:22px;color:#0a0a0a">YOUR BOOKING IS CONFIRMED</h1>
<p style="margin:0 0 8px;font-size:16px;font-weight:700;color:#0a0a0a">${esc(t.clientName)}</p>
<p style="margin:0 0 4px;font-size:15px;color:#333">${date}</p>
<p style="margin:0 0 4px;font-size:15px;color:#333;font-weight:700">${items}</p>
${t.meetingPoint ? `<p style="margin:0 0 4px;font-size:14px;color:#555">Meeting point: ${esc(t.meetingPoint)}</p>` : ""}
${t.boat ? `<p style="margin:0 0 4px;font-size:14px;color:#555">Boat: ${esc(t.boat)}</p>` : ""}
<p style="margin:16px 0 4px;font-size:14px;color:#555">Booking: <strong>${esc(t.reference)}</strong></p>
</td></tr>
<tr><td align="center" style="padding:0 24px 24px">
<img src="${qrDataUrl}" alt="QR code" width="180" height="180" style="display:block;width:180px;height:180px;border:1px solid #e5e7eb;border-radius:4px">
<p style="margin:8px 0 0;font-size:12px;color:#666">Please show this ticket when requested.</p>
</td></tr>
<tr><td align="center" style="padding:0 24px 24px">
<a href="${qrUrl}" style="display:inline-block;background:#2c3792;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:700;font-size:15px">View your ticket</a>
</td></tr>
<tr><td style="border-top:1px solid #e5e7eb;padding:16px 24px;font-size:12px;color:#888;text-align:center">
${esc(t.companyName)}${t.companyPhone ? ` &middot; ${esc(t.companyPhone)}` : ""}
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
