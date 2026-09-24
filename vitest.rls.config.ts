import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// The RLS attack suite (WP-07): runs against the local Supabase stack, signing
// in as real users through the anon key. `npm run db:start` first.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/rls/**/*.test.ts"],
    environment: "node",
    env: loadEnv("", process.cwd(), ""),
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
