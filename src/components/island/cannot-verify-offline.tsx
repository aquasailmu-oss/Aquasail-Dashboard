"use client";

const BIG_BUTTON = "min-h-16 rounded-xl px-4 text-2xl font-bold";
const DARK = "bg-[#0a0a0a] text-white";

export function CannotVerifyOffline({
  manifestAge,
  onScanNext,
  onEnterReference,
}: {
  manifestAge: string | null;
  onScanNext: () => void;
  onEnterReference: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex flex-col bg-[#3b82f6] text-[#0a0a0a]"
      role="alert"
      aria-label="Verdict: CANNOT VERIFY OFFLINE"
      data-testid="verdict"
      data-verdict="CANNOT_VERIFY_OFFLINE"
    >
      <div className="flex-1 overflow-y-auto px-5 pt-6 pb-4">
        <h1 className="font-display text-5xl leading-none font-bold tracking-tight sm:text-6xl">
          CANNOT VERIFY OFFLINE
        </h1>

        <div className="mt-6">
          <p className="text-2xl leading-snug font-bold">
            Wait and retry if you can.
          </p>
          {manifestAge && (
            <p className="mt-2 text-lg font-semibold">{manifestAge}</p>
          )}
          <p className="mt-4 text-lg">
            This ticket is not in the cached manifest. It might be a later booking, a different day, or a forgery.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 bg-black/10 p-4">
        <button type="button" onClick={onEnterReference} className={`${BIG_BUTTON} ${DARK}`}>
          ENTER REFERENCE
        </button>
        <button
          type="button"
          onClick={onScanNext}
          className={`${BIG_BUTTON} border-4 border-[#0a0a0a] bg-white`}
        >
          SCAN NEXT
        </button>
      </div>
    </div>
  );
}
