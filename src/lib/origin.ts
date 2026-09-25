import "server-only";
import { headers } from "next/headers";

/**
 * The origin the user's browser is on, for links in emails and redirects.
 * Behind a proxy (Vercel, Codespaces) the Host header is internal, so the
 * forwarded headers win.
 */
export async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}
