"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchReviewQueue,
  resolveOverRedemption,
  type ReviewItem,
} from "@/actions/island";

export function ReviewQueue() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetchReviewQueue();
    if (res.ok) setItems(res.data);
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
  if (items.length === 0) return (
    <div className="flex flex-col items-center gap-4 p-8 text-center">
      <p className="text-2xl font-bold text-[#22c55e]">All clear</p>
      <p className="text-base text-[#6b7280]">No flagged redemptions to review.</p>
      <button type="button" onClick={load} className="min-h-11 rounded-lg bg-[#2c3792] px-4 font-bold text-white">
        Refresh
      </button>
    </div>
  );

  return (
    <div className="divide-y divide-[#e5e7eb]">
      <div className="flex items-center justify-between px-4 py-2">
        <p className="text-base font-bold">{items.length} item{items.length !== 1 && "s"} to review</p>
        <button type="button" onClick={load} className="min-h-11 rounded-lg bg-[#2c3792] px-3 text-sm font-bold text-white">
          Refresh
        </button>
      </div>
      {items.map((item) => (
        <ReviewCard key={item.redemption_id} item={item} onResolved={load} />
      ))}
    </div>
  );
}

function ReviewCard({ item, onResolved }: { item: ReviewItem; onResolved: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resolve(action: "accept" | "reverse") {
    if (!note.trim()) {
      setError("Add a note saying what happened.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await resolveOverRedemption({
      redemptionId: item.redemption_id,
      action,
      note: note.trim(),
    });
    setBusy(false);
    if (res.ok) onResolved();
    else setError(res.error);
  }

  const time = new Date(item.redeemed_at).toLocaleTimeString("en-MU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Indian/Mauritius",
  });
  const tag = item.is_over_redemption ? "OVER-REDEMPTION" : "PROVISIONAL";

  return (
    <div className="p-4 space-y-3" data-testid="review-card">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-bold">{item.reference} — {item.client_surname}</p>
          <p className="text-base text-[#6b7280]">
            {item.activity_name} × {item.quantity_redeemed} (entitlement: {item.entitlement_quantity})
          </p>
          <p className="text-sm text-[#6b7280]">
            {time} by {item.redeemed_by_name ?? "unknown"} · {item.device_label ?? "no device"}
            {item.location_name && ` · ${item.location_name}`}
          </p>
          {item.occurred_at_device && item.synced_at && (
            <p className="text-sm text-[#6b7280]">
              On device: {new Date(item.occurred_at_device).toLocaleTimeString("en-MU", { hour: "2-digit", minute: "2-digit", timeZone: "Indian/Mauritius" })}
              {" · Synced: "}
              {new Date(item.synced_at).toLocaleTimeString("en-MU", { hour: "2-digit", minute: "2-digit", timeZone: "Indian/Mauritius" })}
            </p>
          )}
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-sm font-bold ${
            item.is_over_redemption ? "bg-[#f87171] text-white" : "bg-[#fbbf24] text-[#0a0a0a]"
          }`}
        >
          {tag}
        </span>
      </div>

      {item.is_stale && (
        <p className="rounded-lg bg-[#fef3c7] px-3 py-2 text-sm font-bold">
          This redemption is more than 48 hours old.
        </p>
      )}

      <textarea
        placeholder="What happened? (required)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        className="w-full rounded-lg border-2 border-[#d1d5db] px-3 py-2 text-base"
      />

      {error && <p className="rounded-lg bg-[#fca5a5] px-3 py-2 text-sm font-bold">{error}</p>}

      <div className="flex gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => resolve("accept")}
          className="min-h-11 flex-1 rounded-lg bg-[#22c55e] px-3 font-bold text-white disabled:opacity-50"
        >
          {busy ? "…" : "ACCEPT"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => resolve("reverse")}
          className="min-h-11 flex-1 rounded-lg bg-[#f87171] px-3 font-bold text-white disabled:opacity-50"
        >
          {busy ? "…" : "REVERSE"}
        </button>
      </div>
    </div>
  );
}
