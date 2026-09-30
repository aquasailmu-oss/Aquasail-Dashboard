import "server-only";
import { create, toDataURL, toBuffer } from "qrcode";

/** Modules of white border the QR spec requires around the code. */
const QUIET_ZONE = 4;

/**
 * What a ticket's QR code encodes: the absolute ticket URL with its opaque
 * token, and nothing else (V2 plan §3). No name, party size, price or
 * reference is ever inside the code.
 */
export function ticketUrl(origin: string, token: string): string {
  return `${origin}/tickets/${token}`;
}

/**
 * A QR code as one SVG path in module units, quiet zone included, so the web
 * ticket (an <svg>) and the PDF (pdf-lib's drawSvgPath) draw the very same
 * shape and cannot drift. Error correction M, as the plan specifies.
 */
export function qrSvgPath(text: string): { size: number; path: string } {
  const { modules } = create(text, { errorCorrectionLevel: "M" });
  const parts: string[] = [];
  for (let row = 0; row < modules.size; row++) {
    for (let col = 0; col < modules.size; col++) {
      if (modules.get(row, col)) parts.push(`M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`);
    }
  }
  return { size: modules.size + 2 * QUIET_ZONE, path: parts.join("") };
}

export async function qrDataUrl(text: string): Promise<string> {
  return toDataURL(text, { errorCorrectionLevel: "M", width: 360, margin: QUIET_ZONE });
}

export async function qrPngBuffer(text: string): Promise<Buffer> {
  return toBuffer(text, { errorCorrectionLevel: "M", width: 360, margin: QUIET_ZONE });
}
