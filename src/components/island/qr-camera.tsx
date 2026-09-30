"use client";

import jsQR from "jsqr";
import { useEffect, useRef, useState } from "react";

// The browser's own QR detector (Android Chrome has one), typed here because
// TypeScript's DOM library does not include it yet.
type Detector = { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> };
type DetectorConstructor = new (options: { formats: string[] }) => Detector;

/** Longest side of the frame handed to jsQR: enough for a ticket at 30cm, fast on a mid-range tablet. */
const MAX_FRAME = 720;

/**
 * Continuous QR scanning from the back camera, with a visible target frame.
 * Decoding uses the native BarcodeDetector where the browser has one and
 * jsQR otherwise; both run on the device, so scanning works with no signal.
 * Calls onCode once per decoded code; the parent pauses it while it shows
 * the verdict.
 */
export function QrCamera({ onCode, paused }: { onCode: (text: string) => void; paused: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const onCodeRef = useRef(onCode);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    onCodeRef.current = onCode;
  }, [onCode]);

  useEffect(() => {
    if (paused) return;
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer = 0;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const Native = (window as unknown as { BarcodeDetector?: DetectorConstructor }).BarcodeDetector;
    const detector = Native ? new Native({ formats: ["qr_code"] }) : null;

    async function decode(v: HTMLVideoElement): Promise<string | null> {
      if (detector) {
        const codes = await detector.detect(v).catch(() => []);
        return codes[0]?.rawValue ?? null;
      }
      if (!ctx || !v.videoWidth) return null;
      const scale = Math.min(1, MAX_FRAME / Math.max(v.videoWidth, v.videoHeight));
      canvas.width = Math.round(v.videoWidth * scale);
      canvas.height = Math.round(v.videoHeight * scale);
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return jsQR(image.data, canvas.width, canvas.height, { inversionAttempts: "dontInvert" })?.data ?? null;
    }

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setProblem("This browser cannot use the camera. Use ENTER REFERENCE.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch {
        setProblem("The camera is not available. Allow camera access, or use ENTER REFERENCE.");
        return;
      }
      const v = video.current;
      if (stopped || !v) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      setProblem(null);
      v.srcObject = stream;
      await v.play().catch(() => undefined);

      const tick = async () => {
        if (stopped) return;
        const text = v.readyState >= 2 ? await decode(v) : null;
        if (stopped) return;
        if (text) {
          onCodeRef.current(text);
          return;
        }
        timer = window.setTimeout(tick, 120);
      };
      void tick();
    })();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [paused]);

  return (
    <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden bg-black">
      <video ref={video} className="absolute inset-0 size-full object-cover" playsInline muted />
      {/* The target frame: where to hold the code. */}
      <div
        aria-hidden
        className="relative size-3/5 rounded-2xl border-[6px] border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"
      />
      {problem && (
        <p
          role="alert"
          className="absolute inset-x-4 bottom-4 rounded-lg bg-white p-4 text-lg font-semibold text-black"
        >
          {problem}
        </p>
      )}
    </div>
  );
}
