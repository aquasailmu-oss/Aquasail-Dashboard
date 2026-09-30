"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatDateLong, formatDateTime } from "@/lib/dates";
import type { ReportData } from "@/app/(app)/reports/redemptions/page";

export function RedemptionReportView({
  data,
  from,
  to,
}: {
  data: ReportData;
  from: string;
  to: string;
}) {
  const router = useRouter();
  const [dateFrom, setDateFrom] = useState(from);
  const [dateTo, setDateTo] = useState(to);

  function apply() {
    router.push(`/reports/redemptions?from=${dateFrom}&to=${dateTo}`);
  }

  const totalEntitled = data.by_activity.reduce((s, a) => s + a.entitled, 0);
  const totalRedeemed = data.by_activity.reduce((s, a) => s + a.redeemed, 0);
  const rate = totalEntitled > 0 ? Math.round((totalRedeemed / totalEntitled) * 100) : 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-semibold">Redemption Report</h1>
        <p className="text-muted-foreground">
          {from === to ? formatDateLong(from) : `${formatDateLong(from)} — ${formatDateLong(to)}`}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm font-semibold">
          From
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="rounded-lg border px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          To
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="rounded-lg border px-3 py-2"
          />
        </label>
        <button
          type="button"
          onClick={apply}
          className="min-h-11 rounded-lg bg-primary px-4 font-semibold text-white"
        >
          Apply
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Entitled" value={totalEntitled} />
        <StatCard label="Redeemed" value={totalRedeemed} />
        <StatCard label="Rate" value={`${rate}%`} />
      </div>

      {data.by_activity.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">By activity</h2>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-left text-xs font-semibold">
                  <th className="px-3 py-2">Activity</th>
                  <th className="px-3 py-2 text-right">Entitled</th>
                  <th className="px-3 py-2 text-right">Redeemed</th>
                  <th className="px-3 py-2 text-right">Outstanding</th>
                  <th className="px-3 py-2 text-right">Rate</th>
                </tr>
              </thead>
              <tbody>
                {data.by_activity.map((a) => (
                  <tr key={a.activity_name} className="border-t">
                    <td className="px-3 py-2 font-semibold">{a.activity_name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{a.entitled}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{a.redeemed}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{a.outstanding}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {a.entitled > 0 ? `${Math.round((a.redeemed / a.entitled) * 100)}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="grid gap-6 md:grid-cols-3">
        {data.by_location.length > 0 && (
          <section>
            <h2 className="mb-2 font-semibold">By location</h2>
            <div className="rounded-lg border divide-y">
              {data.by_location.map((l) => (
                <div key={l.location_name} className="flex justify-between px-3 py-2 text-sm">
                  <span>{l.location_name}</span>
                  <span className="font-semibold tabular-nums">{l.total_redeemed}</span>
                </div>
              ))}
            </div>
          </section>
        )}
        {data.by_device.length > 0 && (
          <section>
            <h2 className="mb-2 font-semibold">By device</h2>
            <div className="rounded-lg border divide-y">
              {data.by_device.map((d) => (
                <div key={d.device_label} className="flex justify-between px-3 py-2 text-sm">
                  <span>{d.device_label}</span>
                  <span className="font-semibold tabular-nums">{d.total_redeemed}</span>
                </div>
              ))}
            </div>
          </section>
        )}
        {data.by_staff.length > 0 && (
          <section>
            <h2 className="mb-2 font-semibold">By staff</h2>
            <div className="rounded-lg border divide-y">
              {data.by_staff.map((s) => (
                <div key={s.staff_name} className="flex justify-between px-3 py-2 text-sm">
                  <span>{s.staff_name}</span>
                  <span className="font-semibold tabular-nums">{s.total_redeemed}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {data.flagged.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">
            Flagged redemptions ({data.flagged.length})
          </h2>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-left text-xs font-semibold">
                  <th className="px-3 py-2">Reference</th>
                  <th className="px-3 py-2">Activity</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">By</th>
                  <th className="px-3 py-2">Resolution</th>
                </tr>
              </thead>
              <tbody>
                {data.flagged.map((f) => (
                  <tr key={f.redemption_id} className="border-t">
                    <td className="px-3 py-2 font-mono font-semibold">{f.reference}</td>
                    <td className="px-3 py-2">{f.activity_name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{f.quantity_redeemed}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-bold ${f.is_over_redemption ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}
                      >
                        {f.is_over_redemption ? "Over" : "Provisional"}
                      </span>
                    </td>
                    <td className="px-3 py-2">{formatDateTime(f.redeemed_at)}</td>
                    <td className="px-3 py-2">{f.redeemed_by}</td>
                    <td className="px-3 py-2">
                      {f.reviewed_at ? (
                        <span className="text-green-700">{f.review_note} ({f.reviewed_by})</span>
                      ) : (
                        <span className="text-muted-foreground">Pending</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border p-4 text-center">
      <div className="text-3xl font-semibold tabular-nums">{value}</div>
      <div className="text-muted-foreground text-sm">{label}</div>
    </div>
  );
}
