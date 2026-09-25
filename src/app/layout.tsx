import type { Metadata } from "next";
import { Jost, Source_Sans_3 } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const jost = Jost({ variable: "--font-jost", subsets: ["latin"], weight: ["500", "600"] });
const sourceSans = Source_Sans_3({
  variable: "--font-source-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "AquaSail Ops",
  description: "Bookings, pricing and daily operations for AquaSail Watersports.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${jost.variable} ${sourceSans.variable} antialiased`}>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
