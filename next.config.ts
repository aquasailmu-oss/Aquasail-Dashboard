import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // forbidden() renders src/app/forbidden.tsx with a real 403 for the wrong role.
  experimental: { authInterrupts: true },
};

export default nextConfig;
