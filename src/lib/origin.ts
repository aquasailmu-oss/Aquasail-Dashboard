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

/** A trusted public base URL for bearer links that will be shared outside the current request. */
export async function publicOrigin(): Promise<string> {
  const configured = process.env.APP_BASE_URL;
  const vercelHost = process.env.VERCEL_URL;
  const vercelProductionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const deploymentHost =
    process.env.VERCEL_ENV === "production"
      ? (vercelProductionHost ?? vercelHost)
      : (vercelHost ?? vercelProductionHost);
  const raw = configured ?? (deploymentHost ? `https://${deploymentHost}` : null);
  const value = raw ?? (process.env.NODE_ENV !== "production" ? await requestOrigin() : null);
  if (!value) throw new Error("Set APP_BASE_URL to the public HTTPS address used for customer waiver links.");
  const parsed = new URL(value);
  if (!new Set(["https:", ...(process.env.NODE_ENV === "production" ? [] : ["http:"])]).has(parsed.protocol)) {
    throw new Error("The public app address must use HTTPS in production.");
  }
  if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("APP_BASE_URL must contain only the public site origin.");
  }
  return parsed.origin;
}
