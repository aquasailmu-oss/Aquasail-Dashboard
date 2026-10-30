import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicWaiverForm } from "@/components/waivers/public-waiver-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getPublicWaiver } from "@/actions/waivers";
import { formatDateLong } from "@/lib/dates";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Participant waiver · AquaSail",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function PublicWaiverPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const waiver = await getPublicWaiver(token);
  if (!waiver?.valid || !waiver.service_date || !waiver.reference) notFound();

  return (
    <main className="min-h-screen px-4 py-8 sm:px-6">
      <Card className="mx-auto max-w-2xl">
        <CardHeader>
          <p className="text-accent-foreground text-sm font-semibold">AquaSail Watersports Ltd</p>
          <CardTitle className="font-display text-2xl">Participant waiver</CardTitle>
          <p className="text-muted-foreground text-sm">
            Booking {waiver.reference} · {formatDateLong(waiver.service_date)}
          </p>
          <p className="text-muted-foreground text-sm">
            Each participant must submit their own waiver. A parent or legal guardian must sign for a child or infant.
          </p>
        </CardHeader>
        <CardContent>
          <PublicWaiverForm token={token} waiver={waiver} />
        </CardContent>
      </Card>
      <p className="text-muted-foreground mx-auto mt-4 max-w-2xl text-center text-xs">
        If this link is not for your booking or you need help, do not sign; contact AquaSail staff.
      </p>
    </main>
  );
}
