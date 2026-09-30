"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { scanCode, scanReference } from "@/actions/island";
import { signOut } from "@/actions/auth";
import type { ScanResult } from "@/lib/scan";
import { tokenFromQr } from "@/lib/scan";
import { useOffline, hashToken } from "@/lib/offline/use-offline";
import type { ManifestBooking } from "@/lib/offline/idb";
import { QrCamera } from "./qr-camera";
import { VerdictView } from "./verdict-view";
import { CannotVerifyOffline } from "./cannot-verify-offline";

type Screen =
  | { kind: "camera" }
  | { kind: "manual"; error?: string }
  | { kind: "checking" }
  | { kind: "result"; result: ScanResult }
  | { kind: "offline_unknown"; manifestAge: string | null }
  | { kind: "problem"; message: string };

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/**
 * The island app (WP-27, WP-29): a persistent status bar, the camera with
 * ENTER REFERENCE as an equal partner, and a full-screen verdict per scan.
 * WP-29 adds: offline manifest in IndexedDB, a queue for redemptions and
 * check-ins, sync on connectivity regain, CANNOT VERIFY OFFLINE for unknown
 * tokens, and over-redemption flagging on sync.
 */
export function IslandApp({
  staffName,
  deviceLabel,
  locationName,
  isSupervisor,
}: {
  staffName: string;
  deviceLabel: string;
  locationName: string | null;
  isSupervisor?: boolean;
}) {
  const [screen, setScreen] = useState<Screen>({ kind: "camera" });
  const [flash, setFlash] = useState(false);
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
  const offline = useOffline();

  const show = useCallback((res: Awaited<ReturnType<typeof scanCode>>) => {
    setScreen(res.ok ? { kind: "result", result: res.data } : { kind: "problem", message: res.error });
  }, []);

  const onCode = useCallback(
    async (text: string) => {
      navigator.vibrate?.(80);
      setFlash(true);
      window.setTimeout(() => setFlash(false), 180);

      if (online) {
        setScreen({ kind: "checking" });
        show(await scanCode(text));
        return;
      }

      // Offline: extract token, hash it, look up in manifest
      const token = tokenFromQr(text);
      if (!token) {
        setScreen({ kind: "offline_unknown", manifestAge: offline.manifestAge });
        return;
      }
      const hash = await hashToken(token);
      const booking = offline.lookupHash(hash);
      if (booking) {
        setScreen({ kind: "result", result: manifestToScanResult(booking) });
      } else {
        setScreen({ kind: "offline_unknown", manifestAge: offline.manifestAge });
      }
    },
    [online, show, offline],
  );

  async function onManual(formData: FormData) {
    const reference = String(formData.get("reference") ?? "").trim();
    if (!reference) {
      setScreen({ kind: "manual", error: "Type the booking reference." });
      return;
    }

    if (online) {
      setScreen({ kind: "checking" });
      show(await scanReference(reference));
      return;
    }

    // Offline: look up reference in manifest
    const booking = offline.lookupReference(reference);
    if (booking) {
      setScreen({ kind: "result", result: manifestToScanResult(booking) });
    } else {
      setScreen({ kind: "offline_unknown", manifestAge: offline.manifestAge });
    }
  }

  const scanNext = () => setScreen({ kind: "camera" });
  const enterReference = () => setScreen({ kind: "manual" });

  return (
    <div className="flex min-h-dvh flex-col bg-white text-lg text-[#0a0a0a]">
      <header
        className="flex items-center justify-between gap-3 bg-[#2c3792] px-4 py-2 text-white"
        data-testid="status-bar"
      >
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate font-bold">{staffName}</span>
          <span className="truncate text-base">
            {deviceLabel}
            {locationName && ` · ${locationName}`}
          </span>
          {offline.manifestAge && (
            <span
              className={`truncate text-sm ${
                offline.manifest && isStale(offline.manifest.generated_at) ? "text-[#fbbf24]" : "text-white/80"
              }`}
              data-testid="manifest-age"
            >
              {offline.manifestAge}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {offline.depth > 0 && (
            <span className="rounded-full bg-white/20 px-3 py-1 text-base font-bold" data-testid="queue-depth">
              {offline.depth} queued
            </span>
          )}
          <span
            className={`rounded-full px-3 py-1 text-base font-bold ${online ? "bg-[#22c55e] text-[#0a0a0a]" : "bg-[#fbbf24] text-[#0a0a0a]"}`}
          >
            {online ? "ONLINE" : "OFFLINE"}
          </span>
          {isSupervisor && (
            <Link
              href="/scan/supervisor"
              className="min-h-14 rounded-lg bg-white/20 px-3 text-base font-bold flex items-center"
            >
              Supervisor
            </Link>
          )}
          <form action={signOut}>
            <button type="submit" className="min-h-14 rounded-lg px-3 text-base font-bold underline">
              Sign out
            </button>
          </form>
        </div>
      </header>

      {/* Over-redemption notice after sync */}
      {offline.overRedemptions > 0 && (
        <div className="bg-[#fbbf24] px-4 py-2 text-base font-bold text-[#0a0a0a]" data-testid="over-redemption-notice">
          {offline.overRedemptions} redemption{offline.overRedemptions === 1 ? "" : "s"} flagged for review.
        </div>
      )}

      {screen.kind === "manual" ? (
        <form action={onManual} className="flex flex-1 flex-col justify-end gap-4 p-4">
          <label htmlFor="reference" className="text-2xl font-bold">
            Booking reference
          </label>
          <p>The digits alone are enough: 0042. Or type the full reference.</p>
          {screen.error && (
            <p role="alert" className="rounded-lg bg-[#f87171] p-3 font-bold">
              {screen.error}
            </p>
          )}
          <input
            id="reference"
            name="reference"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            className="min-h-16 rounded-xl border-4 border-[#0a0a0a] px-4 font-mono text-3xl font-bold"
          />
          <button type="submit" className="min-h-16 rounded-xl bg-[#0a0a0a] text-2xl font-bold text-white">
            CHECK TICKET
          </button>
          <button
            type="button"
            onClick={scanNext}
            className="min-h-14 rounded-xl border-4 border-[#0a0a0a] text-xl font-bold"
          >
            Back to camera
          </button>
        </form>
      ) : (
        <div className="flex flex-1 flex-col">
          <QrCamera onCode={onCode} paused={screen.kind !== "camera"} />
          <div className="flex flex-1 flex-col justify-end gap-3 p-4">
            <p className="text-center">Hold the ticket&rsquo;s code inside the frame.</p>
            <button
              type="button"
              onClick={enterReference}
              className="min-h-16 rounded-xl bg-[#0a0a0a] text-2xl font-bold text-white"
            >
              ENTER REFERENCE
            </button>
          </div>
        </div>
      )}

      {screen.kind === "checking" && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-white text-3xl font-bold" role="status">
          Checking…
        </div>
      )}
      {screen.kind === "problem" && (
        <div className="fixed inset-0 z-40 flex flex-col bg-[#fbbf24]" role="alert">
          <p className="flex-1 p-5 text-2xl font-bold">{screen.message}</p>
          <div className="p-4">
            <button
              type="button"
              onClick={scanNext}
              className="min-h-16 w-full rounded-xl bg-[#0a0a0a] text-2xl font-bold text-white"
            >
              SCAN NEXT
            </button>
          </div>
        </div>
      )}
      {screen.kind === "offline_unknown" && (
        <CannotVerifyOffline
          manifestAge={screen.manifestAge}
          onScanNext={scanNext}
          onEnterReference={enterReference}
        />
      )}
      {screen.kind === "result" && (
        <VerdictView
          result={screen.result}
          onScanNext={scanNext}
          onEnterReference={enterReference}
          staffName={staffName}
          locationName={locationName}
          isOffline={!online}
          enqueueRedeem={offline.enqueueRedeem}
          enqueueCheckIn={offline.enqueueCheckIn}
        />
      )}
      {flash && <div aria-hidden className="pointer-events-none fixed inset-0 z-50 bg-white" />}
    </div>
  );
}

function isStale(generatedAt: string): boolean {
  return Date.now() - new Date(generatedAt).getTime() > 3 * 60 * 60_000;
}

function manifestToScanResult(b: ManifestBooking): ScanResult {
  const remaining = b.entitlements.reduce((sum, e) => sum + Math.max(e.quantity - e.already_redeemed, 0), 0);
  const redeemed = b.entitlements.reduce((sum, e) => sum + e.already_redeemed, 0);
  const verdict = remaining === 0 && redeemed > 0 ? "ALREADY_REDEEMED" : redeemed > 0 ? "PARTLY_USED" : "VALID";
  return {
    verdict,
    booking_id: b.booking_id,
    reference: b.reference,
    client_surname: b.surname,
    client_first_initial: b.client_first_initial,
    adults: b.adults,
    children: b.children,
    infants: b.infants,
    service_date: b.service_date,
    departure_time: b.departure_time,
    meeting_point: b.meeting_point,
    checked_in_at: b.checked_in_at,
    checked_in_by_name: null,
    entitlements: b.entitlements.map((e) => ({
      booking_activity_id: e.booking_activity_id,
      activity_code: e.activity_code,
      activity_name: e.activity_name,
      participant_type: null,
      quantity: e.quantity,
      redeemed: e.already_redeemed,
      remaining: Math.max(e.quantity - e.already_redeemed, 0),
      events: [],
    })),
    not_included: [],
  };
}
