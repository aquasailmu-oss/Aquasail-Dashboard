/**
 * The island app as an installable PWA (WP-27): pinned to a tablet's home
 * screen, it opens straight to the scanner without browser chrome.
 */
export function GET() {
  return Response.json(
    {
      name: "AquaSail Island",
      short_name: "Island",
      description: "Scan AquaSail tickets and redeem activities on the island.",
      start_url: "/scan",
      scope: "/",
      display: "standalone",
      orientation: "portrait",
      background_color: "#ffffff",
      theme_color: "#2c3792",
      icons: [
        { src: "/island-icons/192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
        { src: "/island-icons/512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
      ],
    },
    { headers: { "content-type": "application/manifest+json", "cache-control": "public, max-age=3600" } },
  );
}
