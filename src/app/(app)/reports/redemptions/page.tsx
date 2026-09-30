import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { businessDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { RedemptionReportView } from "@/components/reports/redemption-report-view";

export const metadata: Metadata = { title: "Redemption Report · AquaSail Ops" };

export default async function RedemptionReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requireRole(["admin", "accountant"]);
  const { from, to } = await searchParams;
  const today = businessDate();
  const dateFrom = from ?? today;
  const dateTo = to ?? today;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("redemption_report", {
    p_from: dateFrom,
    p_to: dateTo,
  });

  if (error) {
    return (
      <div>
        <h1 className="font-display text-3xl font-semibold">Redemption Report</h1>
        <p className="text-destructive mt-4">The report could not be loaded. Try again.</p>
      </div>
    );
  }

  return <RedemptionReportView data={data as ReportData} from={dateFrom} to={dateTo} />;
}

type ReportData = {
  from: string;
  to: string;
  by_activity: Array<{ activity_name: string; entitled: number; redeemed: number; outstanding: number }>;
  by_location: Array<{ location_name: string; total_redeemed: number }>;
  by_device: Array<{ device_label: string; total_redeemed: number }>;
  by_staff: Array<{ staff_name: string; total_redeemed: number }>;
  flagged: Array<{
    redemption_id: string;
    reference: string;
    activity_name: string;
    quantity_redeemed: number;
    is_over_redemption: boolean;
    is_provisional: boolean;
    redeemed_at: string;
    redeemed_by: string;
    reviewed_at: string | null;
    review_note: string | null;
    reviewed_by: string | null;
  }>;
};

export type { ReportData };
