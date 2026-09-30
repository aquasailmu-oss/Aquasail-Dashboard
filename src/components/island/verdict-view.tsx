"use client";

import { useEffect, useState } from "react";
import { checkInParty, redeemEntitlement, undoRedemption } from "@/actions/island";
import { formatDateLong, formatTime } from "@/lib/dates";
import { partyCount, partySize, type ScanEntitlement, type ScanEvent, type ScanResult, type Verdict } from "@/lib/scan";

/**
 * One full-screen verdict (V2 plan §8.2), read at arm's length in direct sun:
 * the colour is the message, the word is the largest thing on the screen,
 * text is near-black on the colour field, and "scan next" is always one tap
 * away in the bottom half.
 *
 * On a usable ticket (WP-28) the party is checked in once, then each
 * entitlement is redeemed on its own row, in place. Check-in and redemption
 * are different events (V2 plan §3.2) and stay separate here.
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

/** Staff may undo their own tap for this long; after that it needs a supervisor (the server allows a minute). */
const UNDO_MS = 30_000;

const WHO = { adult: "adults", child: "children", infant: "infants" } as const;

const BIG_BUTTON = "min-h-16 rounded-xl px-4 text-2xl font-bold";
const DARK = "bg-[#0a0a0a] text-white disabled:opacity-60";

function eventLine(e: ScanEvent): string {
  const what = e.is_reversal ? `${-e.quantity} undone` : `${e.quantity} used`;
  return [what, formatTime(new Date(e.at)), e.by_name, e.location_name].filter(Boolean).join(" · ");
}

type Undo = { redemptionId: string; until: number };

function EntitlementRow({
  e,
  canRedeem,
  undo,
  onRedeemed,
  onUndone,
  staffName,
  locationName,
}: {
  e: ScanEntitlement;
  canRedeem: boolean;
  undo: Undo | undefined;
  onRedeemed: (e: ScanEntitlement, undo: Undo) => void;
  onUndone: (e: ScanEntitlement) => void;
  staffName: string;
  locationName: string | null;
}) {
  const [quantity, setQuantity] = useState(e.remaining);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = Math.min(Math.max(quantity, 1), Math.max(e.remaining, 1));

  async function redeem() {
    setBusy(true);
    setError(null);
    // The request id exists before the attempt, so a retry after a dropped connection lands once.
    const res = await redeemEntitlement({
      bookingActivityId: e.booking_activity_id,
      quantity: shown,
      clientUuid: crypto.randomUUID(),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const at = new Date().toISOString();
    onRedeemed(
      {
        ...e,
        redeemed: res.data.redeemed_total,
        remaining: res.data.remaining,
        events: [
          ...e.events,
          {
            redemption_id: res.data.redemption_id,
            quantity: shown,
            at,
            by_name: staffName,
            location_name: locationName,
            device_label: null,
            is_reversal: false,
          },
        ],
      },
      { redemptionId: res.data.redemption_id, until: Date.now() + UNDO_MS },
    );
    setQuantity(res.data.remaining);
  }

  async function undoLast() {
    if (!undo) return;
    setBusy(true);
    setError(null);
    const res = await undoRedemption(undo.redemptionId);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const original = e.events.find((ev) => ev.redemption_id === undo.redemptionId);
    onUndone({
      ...e,
      redeemed: res.data.redeemed_total,
      remaining: res.data.remaining,
      events: [
        ...e.events,
        {
          redemption_id: res.data.redemption_id,
          quantity: -(original?.quantity ?? 0),
          at: new Date().toISOString(),
          by_name: staffName,
          location_name: locationName,
          device_label: null,
          is_reversal: true,
        },
      ],
    });
    setQuantity(res.data.remaining);
  }

  const used = e.remaining === 0;
  return (
    <li className="flex flex-col gap-2 border-b-2 border-black/20 py-3 last:border-b-0" data-testid="entitlement">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xl font-bold">
          {e.activity_name}
          {e.participant_type && <span className="font-semibold"> · {WHO[e.participant_type]}</span>}
        </span>
        <span className="text-xl font-bold whitespace-nowrap tabular-nums" data-testid="remaining">
          {used ? "USED" : `${e.remaining} of ${e.quantity} left`}
        </span>
      </div>
      {e.events.map((ev) => (
        <span key={ev.redemption_id} className="text-lg">
          {eventLine(ev)}
        </span>
      ))}
      {error && (
        <p role="alert" className="rounded-lg bg-white p-3 text-lg font-bold">
          {error}
        </p>
      )}
      {canRedeem && !used && (
        <div className="flex items-stretch gap-2">
          {/* A stepper, not a dropdown or keyboard: "3 of 4" is two taps. */}
          <button
            type="button"
            aria-label={`One fewer ${e.activity_name}`}
            disabled={busy || shown <= 1}
            onClick={() => setQuantity(shown - 1)}
            className="min-h-16 min-w-16 rounded-xl border-4 border-[#0a0a0a] bg-white text-3xl font-bold disabled:opacity-40"
          >
            −
          </button>
          <button type="button" disabled={busy} onClick={redeem} className={`${BIG_BUTTON} ${DARK} flex-1`}>
            {busy ? "…" : `REDEEM ${shown}`}
          </button>
          <button
            type="button"
            aria-label={`One more ${e.activity_name}`}
            disabled={busy || shown >= e.remaining}
            onClick={() => setQuantity(shown + 1)}
            className="min-h-16 min-w-16 rounded-xl border-4 border-[#0a0a0a] bg-white text-3xl font-bold disabled:opacity-40"
          >
            +
          </button>
        </div>
      )}
      {undo && (
        <button
          type="button"
          disabled={busy}
          onClick={undoLast}
          className="min-h-14 rounded-xl border-4 border-[#0a0a0a] bg-white text-xl font-bold"
        >
          UNDO
        </button>
      )}
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
  staffName,
  locationName,
}: {
  result: ScanResult;
  onScanNext: () => void;
  onEnterReference: () => void;
  staffName: string;
  locationName: string | null;
}) {
  const look = LOOK[result.verdict];
  const found = result.verdict === "NOT_FOUND" ? null : result;
  const usable = found !== null && (found.verdict === "VALID" || found.verdict === "PARTLY_USED");

  const [entitlements, setEntitlements] = useState(found?.entitlements ?? []);
  const [checkedIn, setCheckedIn] = useState(
    found?.checked_in_at ? { at: found.checked_in_at, by: found.checked_in_by_name } : null,
  );
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkInError, setCheckInError] = useState<string | null>(null);
  const [undos, setUndos] = useState<Record<string, Undo>>({});

  // The UNDO disappears after 30 seconds, without anyone touching the screen.
  useEffect(() => {
    const live = Object.values(undos);
    if (live.length === 0) return;
    const next = Math.min(...live.map((u) => u.until)) - Date.now();
    const timer = window.setTimeout(
      () => setUndos((u) => Object.fromEntries(Object.entries(u).filter(([, v]) => v.until > Date.now()))),
      Math.max(next, 0) + 50,
    );
    return () => window.clearTimeout(timer);
  }, [undos]);

  // SCAN NEXT is secondary when CHECK IN or ENTER REFERENCE sits above it.
  const hasPrimary = !found || (usable && !checkedIn);

  const replace = (e: ScanEntitlement) =>
    setEntitlements((list) => list.map((x) => (x.booking_activity_id === e.booking_activity_id ? e : x)));

  async function checkIn() {
    if (!found) return;
    setCheckingIn(true);
    setCheckInError(null);
    const res = await checkInParty({ bookingId: found.booking_id, clientUuid: crypto.randomUUID() });
    setCheckingIn(false);
    if (!res.ok) {
      setCheckInError(res.error);
      return;
    }
    setCheckedIn({ at: res.data.checked_in_at, by: res.data.checked_in_by_name });
    setEntitlements(res.data.entitlements);
  }

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

        {!found ? (
          <div className="mt-6">
            <Instruction>Try typing the reference first.</Instruction>
            <p className="mt-2 text-lg">Most of these are a bad scan in bright light.</p>
          </div>
        ) : (
          <>
            <div className="mt-5 flex flex-col gap-1 text-lg">
              <span className="text-3xl font-bold">
                {found.client_first_initial}. {found.client_surname}
              </span>
              <span className="text-xl font-semibold">{partySize(found)}</span>
              <span className="font-mono text-lg font-semibold">
                {found.reference}
                {found.departure_time && ` · ${formatTime(found.departure_time)}`}
                {found.meeting_point && ` · ${found.meeting_point}`}
              </span>
              {checkedIn && (
                <span className="text-xl font-bold" data-testid="checked-in">
                  Checked in {formatTime(new Date(checkedIn.at))}
                  {checkedIn.by && ` by ${checkedIn.by}`}
                </span>
              )}
            </div>

            <div className="mt-5">
              {found.verdict === "CANCELLED" && <Instruction>Do not serve. Call reception.</Instruction>}
              {found.verdict === "REVOKED" && (
                <Instruction>
                  A newer ticket was issued for this booking. Ask the customer to check for a later message.
                </Instruction>
              )}
              {found.verdict === "WRONG_DATE" && (
                <Instruction>
                  This ticket is for {formatDateLong(found.service_date)}. Send them to reception.
                </Instruction>
              )}
              {found.verdict === "ALREADY_REDEEMED" && (
                <Instruction>
                  Everything on this ticket has been used. Show the customer when, by whom and where:
                </Instruction>
              )}
            </div>

            {(usable || found.verdict === "ALREADY_REDEEMED") && (
              <ul className="mt-2" aria-label="Entitlements">
                {entitlements.map((e) => (
                  <EntitlementRow
                    key={e.booking_activity_id}
                    e={e}
                    canRedeem={usable}
                    undo={undos[e.booking_activity_id]}
                    staffName={staffName}
                    locationName={locationName}
                    onRedeemed={(next, undo) => {
                      replace(next);
                      setUndos((u) => ({ ...u, [next.booking_activity_id]: undo }));
                    }}
                    onUndone={(next) => {
                      replace(next);
                      setUndos(({ [next.booking_activity_id]: _gone, ...rest }) => rest);
                    }}
                  />
                ))}
                {/* What the booking does not include, so "is parasailing included?" gets an answer. */}
                {found.not_included.map((n) => (
                  <li
                    key={n.activity_code}
                    className="flex items-baseline justify-between gap-3 border-b-2 border-black/10 py-3 text-xl text-black/55 last:border-b-0"
                    data-testid="not-included"
                  >
                    <span className="font-semibold">{n.activity_name}</span>
                    <span className="font-bold">NOT INCLUDED</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {/* Primary actions stay in the bottom half, for one thumb. */}
      <div className="flex flex-col gap-3 bg-black/10 p-4">
        {checkInError && (
          <p role="alert" className="rounded-lg bg-white p-3 text-lg font-bold">
            {checkInError}
          </p>
        )}
        {usable && !checkedIn && found && (
          <button type="button" disabled={checkingIn} onClick={checkIn} className={`${BIG_BUTTON} ${DARK}`}>
            {checkingIn
              ? "Checking in…"
              : `CHECK IN · ${partyCount(found)} ${partyCount(found) === 1 ? "person" : "people"}`}
          </button>
        )}
        {!found && (
          <button type="button" onClick={onEnterReference} className={`${BIG_BUTTON} ${DARK}`}>
            ENTER REFERENCE
          </button>
        )}
        <button
          type="button"
          onClick={onScanNext}
          className={`${BIG_BUTTON} ${hasPrimary ? "border-4 border-[#0a0a0a] bg-white" : DARK}`}
        >
          SCAN NEXT
        </button>
      </div>
    </div>
  );
}
