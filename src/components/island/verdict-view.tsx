"use client";

import { formatDateLong, formatTime } from "@/lib/dates";
import { partySize, type ScanEntitlement, type ScanEvent, type ScanResult, type Verdict } from "@/lib/scan";

/**
 * One full-screen verdict (V2 plan §8.2), read at arm's length in direct sun:
 * the colour is the message, the word is the largest thing on the screen,
 * text is near-black on the colour field, and "scan next" is always one tap
 * away in the bottom half. Check-in and redemption actions arrive in WP-28.
 */

const LOOK: Record<Verdict, { word: string; field: string }> = {
  VALID: { word: "VALID", field: "bg-[#22c55e]" },
  PARTLY_USED: { word: "PARTLY USED", field: "bg-[#22c55e]" },
  ALREADY_REDEEMED: { word: "ALREADY REDEEMED", field: "bg-[#fbbf24]" },
  WRONG_DATE: { word: "WRONG DATE", field: "bg-[#fbbf24]" },
  CANCELLED: { word: "CANCELLED", field: "bg-[#f87171]" },
  REVOKED: { word: "REVOKED", field: "bg-[#f87171]" },
  NOT_FOUND: { word: "NOT FOUND", field: "bg-[#f87171]" },
};

const WHO = { adult: "adults", child: "children", infant: "infants" } as const;

function eventLine(e: ScanEvent): string {
  const what = e.is_reversal ? `${-e.quantity} given back` : `${e.quantity} used`;
  return [what, formatTime(new Date(e.at)), e.by_name, e.location_name].filter(Boolean).join(" · ");
}

function Entitlement({ e }: { e: ScanEntitlement }) {
  const used = e.remaining === 0;
  return (
    <li className="flex flex-col gap-1 border-b-2 border-black/20 py-3 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xl font-bold">
          {e.activity_name}
          {e.participant_type && <span className="font-semibold"> · {WHO[e.participant_type]}</span>}
        </span>
        <span className="text-xl font-bold whitespace-nowrap tabular-nums">
          {used ? "USED" : `${e.remaining} of ${e.quantity} left`}
        </span>
      </div>
      {e.events.map((ev) => (
        <span key={ev.redemption_id} className="text-lg">
          {eventLine(ev)}
        </span>
      ))}
    </li>
  );
}

function Instruction({ children }: { children: React.ReactNode }) {
  return <p className="text-2xl leading-snug font-bold">{children}</p>;
}

export function VerdictView({
  result,
  onScanNext,
  onEnterReference,
}: {
  result: ScanResult;
  onScanNext: () => void;
  onEnterReference: () => void;
}) {
  const look = LOOK[result.verdict];
  return (
    <div
      className={`fixed inset-0 z-40 flex flex-col text-[#0a0a0a] ${look.field}`}
      role="alert"
      aria-label={`Verdict: ${look.word}`}
      data-testid="verdict"
      data-verdict={result.verdict}
    >
      <div className="flex-1 overflow-y-auto px-5 pt-6 pb-4">
        <h1 className="font-display text-5xl leading-none font-bold tracking-tight break-words sm:text-6xl">
          {look.word}
        </h1>

        {result.verdict === "NOT_FOUND" ? (
          <div className="mt-6">
            <Instruction>Try typing the reference first.</Instruction>
            <p className="mt-2 text-lg">Most of these are a bad scan in bright light.</p>
          </div>
        ) : (
          <>
            <div className="mt-5 flex flex-col gap-1 text-lg">
              <span className="text-3xl font-bold">
                {result.client_first_initial}. {result.client_surname}
              </span>
              <span className="text-xl font-semibold">{partySize(result)}</span>
              <span className="font-mono text-lg font-semibold">
                {result.reference}
                {result.departure_time && ` · ${formatTime(result.departure_time)}`}
                {result.meeting_point && ` · ${result.meeting_point}`}
              </span>
              {result.checked_in_at && (
                <span className="font-semibold">
                  Checked in {formatTime(new Date(result.checked_in_at))}
                  {result.checked_in_by_name && ` by ${result.checked_in_by_name}`}
                </span>
              )}
            </div>

            <div className="mt-5">
              {result.verdict === "CANCELLED" && <Instruction>Do not serve. Call reception.</Instruction>}
              {result.verdict === "REVOKED" && (
                <Instruction>
                  A newer ticket was issued for this booking. Ask the customer to check for a later message.
                </Instruction>
              )}
              {result.verdict === "WRONG_DATE" && (
                <Instruction>
                  This ticket is for {formatDateLong(result.service_date)}. Send them to reception.
                </Instruction>
              )}
              {result.verdict === "ALREADY_REDEEMED" && (
                <Instruction>
                  Everything on this ticket has been used. Show the customer when, by whom and where:
                </Instruction>
              )}
            </div>

            {["VALID", "PARTLY_USED", "ALREADY_REDEEMED"].includes(result.verdict) && (
              <>
                <ul className="mt-2" aria-label="Entitlements">
                  {result.entitlements.map((e) => (
                    <Entitlement key={e.booking_activity_id} e={e} />
                  ))}
                </ul>
                {result.not_included.length > 0 && (
                  <div className="mt-4 text-lg" aria-label="Not included">
                    <span className="font-bold">NOT INCLUDED:</span>{" "}
                    {result.not_included.map((n) => n.activity_name).join(", ")}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Primary actions stay in the bottom half, for one thumb. */}
      <div className="flex flex-col gap-3 bg-black/10 p-4">
        {result.verdict === "NOT_FOUND" && (
          <button
            type="button"
            onClick={onEnterReference}
            className="min-h-16 rounded-xl bg-[#0a0a0a] px-4 text-2xl font-bold text-white"
          >
            ENTER REFERENCE
          </button>
        )}
        <button
          type="button"
          onClick={onScanNext}
          className={`min-h-16 rounded-xl px-4 text-2xl font-bold ${
            result.verdict === "NOT_FOUND" ? "border-4 border-[#0a0a0a] bg-white" : "bg-[#0a0a0a] text-white"
          }`}
        >
          SCAN NEXT
        </button>
      </div>
    </div>
  );
}
