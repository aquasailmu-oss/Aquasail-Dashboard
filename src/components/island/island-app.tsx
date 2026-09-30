"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { scanCode, scanReference } from "@/actions/island";
import { signOut } from "@/actions/auth";
import type { ScanResult } from "@/lib/scan";
import { QrCamera } from "./qr-camera";
import { VerdictView } from "./verdict-view";

type Screen =
  | { kind: "camera" }
  | { kind: "manual"; error?: string }
  | { kind: "checking" }
  | { kind: "result"; result: ScanResult }
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
 * The island app (WP-27): a persistent status bar, the camera with ENTER
 * REFERENCE as an equal partner, and a full-screen verdict per scan. Built
 * for someone on sand, in sun, with wet hands and one free thumb: 56px+
 * targets, 18px+ text, no hover, nothing important at the top of the screen.
 */
export function IslandApp({
  staffName,
  deviceLabel,
  locationName,
}: {
  staffName: string;
  deviceLabel: string;
  locationName: string | null;
}) {
  const [screen, setScreen] = useState<Screen>({ kind: "camera" });
  const [flash, setFlash] = useState(false);
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );

  const show = useCallback((res: Awaited<ReturnType<typeof scanCode>>) => {
    setScreen(res.ok ? { kind: "result", result: res.data } : { kind: "problem", message: res.error });
  }, []);

  const onCode = useCallback(
    async (text: string) => {
      // In bright sun a screen change alone is easy to miss: buzz and flash too.
      navigator.vibrate?.(80);
      setFlash(true);
      window.setTimeout(() => setFlash(false), 180);
      setScreen({ kind: "checking" });
      show(await scanCode(text));
    },
    [show],
  );

  async function onManual(formData: FormData) {
    const reference = String(formData.get("reference") ?? "").trim();
    if (!reference) {
      setScreen({ kind: "manual", error: "Type the booking reference." });
      return;
    }
    setScreen({ kind: "checking" });
    show(await scanReference(reference));
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
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-3 py-1 text-base font-bold ${online ? "bg-[#22c55e] text-[#0a0a0a]" : "bg-[#fbbf24] text-[#0a0a0a]"}`}
          >
            {online ? "ONLINE" : "OFFLINE"}
          </span>
          <form action={signOut}>
            <button type="submit" className="min-h-14 rounded-lg px-3 text-base font-bold underline">
              Sign out
            </button>
          </form>
        </div>
      </header>

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
      {screen.kind === "result" && (
        <VerdictView result={screen.result} onScanNext={scanNext} onEnterReference={enterReference} />
      )}
      {flash && <div aria-hidden className="pointer-events-none fixed inset-0 z-50 bg-white" />}
    </div>
  );
}
