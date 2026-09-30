"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchShiftSummary, type ShiftSummary } from "@/actions/island";

export function ShiftHandover() {
  const [summary, setSummary] = useState<ShiftSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetchShiftSummary();
    if (res.ok) setSummary(res.data);
    else setError(res.error);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <p className="p-4 text-center text-base">Loading…</p>;
  if (error) return (
    <div className="p-4">
      <p className="rounded-lg bg-[#fca5a5] p-3 font-bold">{error}</p>
      <button type="button" onClick={load} className="mt-3 min-h-11 rounded-lg bg-[#2c3792] px-4 font-bold text-white">
        Retry
      </button>
    </div>
  );
  if (!summary) return null;

  const totalRedeemed = summary.redemptions.reduce((sum, r) => sum + r.total_redeemed, 0);

  return (
    <div className="p-4 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-2xl font-bold">{summary.device_label}</p>
          <p className="text-base text-[#6b7280]">{summary.date}</p>
        </div>
        <button type="button" onClick={load} className="min-h-11 rounded-lg bg-[#2c3792] px-3 text-sm font-bold text-white">
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Check-ins" value={summary.check_ins} />
        <StatCard label="Redeemed" value={totalRedeemed} />
        <StatCard label="Flagged" value={summary.flagged} warn={summary.flagged > 0} />
      </div>

      {summary.redemptions.length > 0 && (
        <div>
          <p className="mb-2 text-base font-bold text-[#6b7280]">Redemptions by activity</p>
          <div className="divide-y divide-[#e5e7eb] rounded-lg border border-[#e5e7eb]">
            {summary.redemptions.map((r) => (
              <div key={r.activity_name} className="flex items-center justify-between px-4 py-3">
                <span className="font-bold">{r.activity_name}</span>
                <span className="rounded-full bg-[#f3f4f6] px-3 py-1 text-base font-bold">
                  {r.total_redeemed}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {summary.redemptions.length === 0 && (
        <p className="text-center text-base text-[#6b7280]">No redemptions on this device today.</p>
      )}
    </div>
  );
}

function StatCard({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className={`rounded-lg border-2 p-3 text-center ${warn ? "border-[#f87171] bg-[#fef2f2]" : "border-[#e5e7eb]"}`}>
      <p className="text-3xl font-bold">{value}</p>
      <p className="text-sm text-[#6b7280]">{label}</p>
    </div>
  );
}
