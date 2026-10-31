import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { authorize } from "@/lib/auth";
import { formatDateLong, formatDateTime, formatTime } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { getTicket } from "@/lib/tickets";

const A5: [number, number] = [419.53, 595.28];
const M = 28; // margin, points
const BLACK = rgb(0, 0, 0);

/** The standard PDF fonts only cover Latin-1; anything else prints as "?" rather than failing. */
const safe = (s: string) => s.replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");

function wrapText(value: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = safe(value).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * The same ticket as /tickets/[token], as a PDF, for attaching to emails in
 * V2. Content comes from getTicket(), the single source for both. Staff-only
 * in V1, like the print page.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const auth = await authorize(["admin", "receptionist"]);
  if (!auth.ok) return new NextResponse(auth.error, { status: 403 });
  const { token } = await params;
  const t = await getTicket(token);
  if (!t) return new NextResponse("Ticket not found.", { status: 404 });

  const pdf = await PDFDocument.create();
  pdf.setTitle(`Ticket ${t.reference}`);
  let page = pdf.addPage(A5);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.CourierBold);
  const [W, H] = A5;
  let y = H - M;

  const text = (p: PDFPage, s: string, x: number, yy: number, size: number, font: PDFFont) =>
    p.drawText(safe(s), { x, y: yy, size, font, color: BLACK });

  // Header: logo (PNG/JPEG only) or company name, and the title.
  let logoDrawn = false;
  if (t.logoPath) {
    const supabase = await createClient();
    const url = supabase.storage.from("branding").getPublicUrl(t.logoPath).data.publicUrl;
    const res = await fetch(url);
    if (res.ok) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      const type = res.headers.get("content-type") ?? "";
      const image = type.includes("png")
        ? await pdf.embedPng(bytes)
        : type.includes("jpeg")
          ? await pdf.embedJpg(bytes)
          : null;
      if (image) {
        const scaled = image.scaleToFit(140, 40);
        page.drawImage(image, { x: M, y: y - scaled.height, width: scaled.width, height: scaled.height });
        logoDrawn = true;
      }
    }
  }
  if (!logoDrawn) text(page, t.companyName, M, y - 16, 14, bold);
  const title = "ACTIVITY TICKET";
  text(page, title, W - M - bold.widthOfTextAtSize(title, 14), y - 16, 14, bold);
  y -= 50;
  text(page, t.companyName + (t.companyPhone ? `  ·  ${t.companyPhone}` : ""), M, y, 9, regular);
  y -= 8;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1.5, color: BLACK });
  y -= 22;

  if (t.cancelled) {
    text(page, "CANCELLED: THIS TICKET IS NOT VALID", M, y, 13, bold);
    y -= 24;
  }

  // Details on the left, the V2 QR square on the right.
  const qr = 96;
  page.drawRectangle({
    x: W - M - qr,
    y: y - qr + 10,
    width: qr,
    height: qr,
    borderColor: BLACK,
    borderWidth: 1,
    borderDashArray: [4, 3],
  });
  const refSize = 8;
  text(
    page,
    t.reference,
    W - M - qr / 2 - mono.widthOfTextAtSize(t.reference, refSize) / 2,
    y - qr / 2 + 6,
    refSize,
    mono,
  );

  const field = (label: string, value: string, strong = false) => {
    text(page, label.toUpperCase(), M, y, 7, bold);
    y -= 13;
    text(page, value, M, y, strong ? 13 : 11, strong ? bold : regular);
    y -= 20;
  };
  field("Guest", t.clientName, true);
  field("Party", t.participants);
  field("Date", `${formatDateLong(t.serviceDate)}${t.departureTime ? `, ${formatTime(t.departureTime)}` : ""}`);
  field("Meeting point", t.meetingPoint);
  if (t.boat) field("Boat", t.boat);

  y -= 4;
  text(page, t.items.join(" + ").toUpperCase(), M, y, 8, bold);
  y -= 6;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.75, color: BLACK });
  y -= 16;
  for (const e of t.entitlements) {
    page.drawRectangle({ x: M, y: y - 2, width: 10, height: 10, borderColor: BLACK, borderWidth: 1.2 });
    text(page, e.name, M + 16, y, 11, regular);
    const q = e.units !== e.quantity ? `x ${e.quantity} pax (${e.units} ride units)` : `x ${e.quantity} pax`;
    text(page, q, W - M - bold.widthOfTextAtSize(q, 11), y, 11, bold);
    y -= 18;
  }

  y -= 6;
  if (t.signatureData && t.signerName && t.signedAt) {
    text(page, "LEGACY CUSTOMER DISCLAIMER", M, y, 7, bold);
    y -= 12;
    const disclaimerLines = wrapText(t.disclaimerText, regular, 7, W - M * 2);
    for (const line of disclaimerLines) {
      if (y < M + 105) {
        page = pdf.addPage(A5);
        y = H - M;
        text(page, "CUSTOMER DISCLAIMER (CONTINUED)", M, y, 7, bold);
        y -= 16;
      }
      text(page, line, M, y, 7, regular);
      y -= 9;
    }
    if (y < M + 70) {
      page = pdf.addPage(A5);
      y = H - M - 16;
    }
    const encoded = t.signatureData.split(",")[1];
    if (encoded) {
      const signature = await pdf.embedPng(Buffer.from(encoded, "base64"));
      const size = signature.scaleToFit(150, 36);
      page.drawImage(signature, { x: M, y: y - size.height, width: size.width, height: size.height });
      y -= size.height + 2;
    }
    text(page, `Signed by ${t.signerName} · ${formatDateTime(t.signedAt)}`, M, y, 7, regular);
  } else {
    text(page, "PARTICIPANT WAIVERS", M, y, 7, bold);
    y -= 14;
    text(page, `${t.waiverCount} of ${t.requiredWaivers} participant waivers signed`, M, y, 8, bold);
    y -= 12;
    if (t.waiverCount < t.requiredWaivers)
      text(page, "OUTSTANDING - collect remaining waivers before the activity", M, y, 7, bold);
  }

  // Reference and footer at the bottom.
  const ref = t.reference;
  text(page, "BOOKING REFERENCE", W / 2 - bold.widthOfTextAtSize("BOOKING REFERENCE", 7) / 2, M + 58, 7, bold);
  text(page, ref, W / 2 - mono.widthOfTextAtSize(ref, 22) / 2, M + 34, 22, mono);
  if (t.footer) {
    const footer = safe(t.footer).slice(0, 120);
    text(page, footer, W / 2 - regular.widthOfTextAtSize(footer, 8) / 2, M + 12, 8, regular);
  }

  const bytes = await pdf.save();
  return new NextResponse(bytes as unknown as BodyInit, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="Ticket_${t.reference}.pdf"`,
      "cache-control": "no-store",
    },
  });
}
