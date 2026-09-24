import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { authorize } from "@/lib/auth";
import { formatDateLong, formatTime } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { getTicket } from "@/lib/tickets";

const A5: [number, number] = [419.53, 595.28];
const M = 28; // margin, points
const BLACK = rgb(0, 0, 0);

/** The standard PDF fonts only cover Latin-1; anything else prints as "?" rather than failing. */
const safe = (s: string) => s.replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");

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
  const page = pdf.addPage(A5);
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
    text(page, e.name, M, y, 11, regular);
    const q = `x ${e.quantity}`;
    text(page, q, W - M - bold.widthOfTextAtSize(q, 11), y, 11, bold);
    y -= 18;
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
