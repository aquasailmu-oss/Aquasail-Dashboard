import type { NextConfig } from "next";

// Codespaces: the browser is on https://<name>-3000.app.github.dev. The port
// forwarder sets x-forwarded-host to that address but rewrites a same-site
// Origin header to http://localhost:3000, so Next.js sees mismatched hosts and
// rejects every Server Action ("Invalid Server Actions request"). Inside a
// Codespace, allow the rewritten origin (and the public one, should the
// forwarder ever pass it through). A foreign site's Origin is passed through
// unchanged and still rejected. These variables are unset on Vercel, where the
// strict same-origin default applies.
const { CODESPACE_NAME, GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN } = process.env;
const codespaceOrigins =
  CODESPACE_NAME && GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN
    ? ["localhost:3000", `${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`]
    : undefined;

const nextConfig: NextConfig = {
  experimental: {
    // forbidden() renders src/app/forbidden.tsx with a real 403 for the wrong role.
    authInterrupts: true,
    ...(codespaceOrigins && { serverActions: { allowedOrigins: codespaceOrigins } }),
  },
};

export default nextConfig;
