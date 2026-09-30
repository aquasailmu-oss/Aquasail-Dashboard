"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchManifest, syncQueueItem } from "@/actions/island";
import type { ManifestBooking, ManifestData, QueueItem } from "./idb";
import { clearSynced, enqueue, loadManifest, markSynced, pendingItems, queueDepth, saveManifest } from "./idb";

export type OfflineState = {
  manifest: ManifestData | null;
  manifestAge: string | null;
  depth: number;
  overRedemptions: number;
  refreshing: boolean;
  syncing: boolean;
  refresh: () => Promise<void>;
  sync: () => Promise<void>;
  lookupHash: (tokenHash: string) => ManifestBooking | undefined;
  lookupReference: (reference: string) => ManifestBooking | undefined;
  enqueueRedeem: (item: {
    bookingActivityId: string;
    quantity: number;
    clientUuid: string;
  }) => Promise<void>;
  enqueueCheckIn: (item: { bookingId: string; clientUuid: string }) => Promise<void>;
};

function manifestAge(generatedAt: string): string {
  const ms = Date.now() - new Date(generatedAt).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
}

function formatSyncTime(generatedAt: string): string {
  const d = new Date(generatedAt);
  return d.toLocaleTimeString("en-MU", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function useOffline(): OfflineState {
  const [manifest, setManifest] = useState<ManifestData | null>(null);
  const [depth, setDepth] = useState(0);
  const [overRedemptions, setOverRedemptions] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [ageText, setAgeText] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Load manifest from IndexedDB on mount
  useEffect(() => {
    loadManifest().then((m) => {
      if (m && mountedRef.current) setManifest(m);
    });
    queueDepth().then((d) => {
      if (mountedRef.current) setDepth(d);
    });
  }, []);

  // Keep the age text up-to-date every 30 seconds
  useEffect(() => {
    if (!manifest) {
      setAgeText(null);
      return;
    }
    const update = () => setAgeText(`Synced ${formatSyncTime(manifest.generated_at)} · ${manifestAge(manifest.generated_at)}`);
    update();
    const timer = window.setInterval(update, 30_000);
    return () => window.clearInterval(timer);
  }, [manifest]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const res = await fetchManifest();
    if (!mountedRef.current) return;
    setRefreshing(false);
    if (res.ok) {
      setManifest(res.data);
      await saveManifest(res.data);
    }
  }, []);

  const sync = useCallback(async () => {
    setSyncing(true);
    const items = await pendingItems();
    let overs = 0;
    for (const item of items) {
      const res = await syncQueueItem(item.type, item.payload);
      if (!mountedRef.current) return;
      if (res.ok) {
        await markSynced(item.id, res.data.result, res.data.reason);
        if (res.data.result === "over_redemption") overs++;
      }
    }
    await clearSynced();
    if (!mountedRef.current) return;
    setDepth(await queueDepth());
    setOverRedemptions((prev) => prev + overs);
    setSyncing(false);
  }, []);

  // Refresh manifest and sync queue on connectivity regain and on focus
  useEffect(() => {
    const onOnline = () => {
      refresh();
      sync();
    };
    const onFocus = () => {
      if (navigator.onLine) {
        refresh();
        sync();
      }
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh, sync]);

  // Initial fetch on mount if online
  useEffect(() => {
    if (navigator.onLine) {
      refresh();
      sync();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lookupHash = useCallback(
    (tokenHash: string) => manifest?.bookings.find((b) => b.token_hash === tokenHash),
    [manifest],
  );

  const lookupReference = useCallback(
    (reference: string) => {
      if (!manifest) return undefined;
      const upper = reference.toUpperCase().trim();
      return manifest.bookings.find(
        (b) => b.reference === upper || b.reference.endsWith(`-${upper.replace(/^0+/, "")}`),
      );
    },
    [manifest],
  );

  const enqueueRedeem = useCallback(
    async (item: { bookingActivityId: string; quantity: number; clientUuid: string }) => {
      const now = new Date().toISOString();
      const qi: QueueItem = {
        id: item.clientUuid,
        type: "redeem",
        client_uuid: item.clientUuid,
        payload: {
          booking_activity_id: item.bookingActivityId,
          quantity: item.quantity,
          client_uuid: item.clientUuid,
          occurred_at_device: now,
        },
        created_at: now,
        occurred_at_device: now,
      };
      await enqueue(qi);
      setDepth(await queueDepth());
    },
    [],
  );

  const enqueueCheckIn = useCallback(async (item: { bookingId: string; clientUuid: string }) => {
    const now = new Date().toISOString();
    const qi: QueueItem = {
      id: item.clientUuid,
      type: "check_in",
      client_uuid: item.clientUuid,
      payload: {
        booking_id: item.bookingId,
        client_uuid: item.clientUuid,
        occurred_at_device: now,
      },
      created_at: now,
      occurred_at_device: now,
    };
    await enqueue(qi);
    setDepth(await queueDepth());
  }, []);

  return {
    manifest,
    manifestAge: ageText,
    depth,
    overRedemptions,
    refreshing,
    syncing,
    refresh,
    sync,
    lookupHash,
    lookupReference,
    enqueueRedeem,
    enqueueCheckIn,
  };
}

/** Hash a token the same way the server does (sha256 hex). */
export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
