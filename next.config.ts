import type { NextConfig } from "next";

// In a Codespace the browser is on https://<name>-3000.app.github.dev while the
// server sees Host: localhost:3000, so Next.js rejects every Server Action as
// cross-site ("Invalid Server Actions request"). Allow exactly this Codespace's
// forwarded origin. The variables are unset on Vercel, where origin and host
// match and the strict default applies.
const { CODESPACE_NAME, GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN } = process.env;
const codespaceOrigin =
  CODESPACE_NAME && GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN
    ? `${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`
    : undefined;

const nextConfig: NextConfig = {
  experimental: {
    // forbidden() renders src/app/forbidden.tsx with a real 403 for the wrong role.
    authInterrupts: true,
    ...(codespaceOrigin && { serverActions: { allowedOrigins: [codespaceOrigin] } }),
  },
};

export default nextConfig;
