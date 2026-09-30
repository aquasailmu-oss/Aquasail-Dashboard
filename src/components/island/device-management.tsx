"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchDeviceList, deactivateDevice, type DeviceInfo } from "@/actions/island";

export function DeviceManagement() {
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetchDeviceList();
    if (res.ok) setDevices(res.data);
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

  const active = devices.filter((d) => d.is_active);
  const inactive = devices.filter((d) => !d.is_active);

  return (
    <div className="divide-y divide-[#e5e7eb]">
      <div className="flex items-center justify-between px-4 py-2">
        <p className="text-base font-bold">{active.length} active device{active.length !== 1 && "s"}</p>
        <button type="button" onClick={load} className="min-h-11 rounded-lg bg-[#2c3792] px-3 text-sm font-bold text-white">
          Refresh
        </button>
      </div>
      {active.map((d) => (
        <DeviceCard key={d.device_id} device={d} onDeactivated={load} />
      ))}
      {inactive.length > 0 && (
        <>
          <p className="px-4 py-2 text-base font-bold text-[#6b7280]">
            {inactive.length} deactivated
          </p>
          {inactive.map((d) => (
            <DeviceCard key={d.device_id} device={d} onDeactivated={load} />
          ))}
        </>
      )}
    </div>
  );
}

function DeviceCard({ device, onDeactivated }: { device: DeviceInfo; onDeactivated: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDeactivate() {
    setBusy(true);
    setError(null);
    const res = await deactivateDevice(device.device_id);
    setBusy(false);
    if (res.ok) {
      setConfirming(false);
      onDeactivated();
    } else {
      setError(res.error);
    }
  }

  const lastSeen = device.last_seen_at
    ? new Date(device.last_seen_at).toLocaleString("en-MU", {
        hour: "2-digit",
        minute: "2-digit",
        day: "numeric",
        month: "short",
        timeZone: "Indian/Mauritius",
      })
    : "never";

  return (
    <div className="p-4 space-y-2" data-testid="device-card">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-bold">{device.label}</p>
          <p className="text-sm text-[#6b7280]">
            {device.location_name ?? "No location"} · Last seen: {lastSeen}
          </p>
        </div>
        {device.is_active ? (
          <span className="shrink-0 rounded-full bg-[#22c55e] px-3 py-1 text-sm font-bold text-white">
            Active
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-[#6b7280] px-3 py-1 text-sm font-bold text-white">
            Inactive
          </span>
        )}
      </div>

      {device.is_active && !confirming && (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="min-h-11 rounded-lg border-2 border-[#f87171] px-3 text-sm font-bold text-[#f87171]"
        >
          Deactivate
        </button>
      )}

      {confirming && (
        <div className="rounded-lg bg-[#fef2f2] p-3 space-y-2">
          <p className="text-sm font-bold">Deactivating will stop this device from scanning or redeeming immediately.</p>
          {error && <p className="text-sm font-bold text-[#dc2626]">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={handleDeactivate}
              className="min-h-11 rounded-lg bg-[#f87171] px-4 text-sm font-bold text-white disabled:opacity-50"
            >
              {busy ? "…" : "Confirm deactivate"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => { setConfirming(false); setError(null); }}
              className="min-h-11 rounded-lg border-2 border-[#d1d5db] px-4 text-sm font-bold"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
