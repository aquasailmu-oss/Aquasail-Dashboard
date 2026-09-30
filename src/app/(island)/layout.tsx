import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Island · AquaSail Ops",
  manifest: "/island.webmanifest",
  appleWebApp: { capable: true, title: "Island", statusBarStyle: "default" },
};

export const viewport: Viewport = { themeColor: "#2c3792", width: "device-width", initialScale: 1 };

/** The island app: full screen, no office sidebar. Pages check the role themselves. */
export default function IslandLayout({ children }: { children: React.ReactNode }) {
  return <main id="main-content">{children}</main>;
}
