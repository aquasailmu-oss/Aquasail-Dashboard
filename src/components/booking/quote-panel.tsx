"use client";

import { Alert } from "@/components/ui/alert";
import { cents, formatRs, type Cents } from "@/lib/money";
import type { Quote } from "@/lib/pricing/types";
import { cn } from "@/lib/utils";

const TYPE = { adult: "adult", child: "child", infant: "infant" } as const;

/** The live quote: what reception reads out to the customer. */
export function QuotePanel({
  quote,
  error,
  stale,
  empty,
  changeDue,
}: {
  quote: Quote | null;
  error: string | null;
  stale: boolean;
  empty: boolean;
  changeDue: Cents | null;
}) {
  if (empty) {
    return <p className="text-muted-foreground py-6 text-center">Pick a package or activity to see the price.</p>;
  }
  if (error) {
    return (
      <Alert variant="destructive" aria-live="assertive">
        <div className="font-semibold">{error}</div>
      </Alert>
    );
  }
  if (!quote) return <p className="text-muted-foreground py-6 text-center">Working out the price…</p>;

  return (
    <div
      className={cn("flex flex-col gap-2 transition-opacity", stale && "opacity-60")}
      aria-live="polite"
      aria-busy={stale}
    >
      <ul className="flex flex-col gap-2">
        {quote.lines.map((l, i) => (
          <li key={i} className="flex justify-between gap-3">
            <span>
              <span className="font-semibold">{l.name}</span>
              <span className="text-muted-foreground text-sm">
                {" "}
                × {l.quantity} {TYPE[l.participant_type]}
              </span>
              {l.line_type === "package" && l.includes.length > 0 && (
                <span className="text-muted-foreground block text-sm">{l.includes.join(" · ")}</span>
              )}
            </span>
            <span className="tabular-nums">{formatRs(cents(l.unit_charged_cents * l.quantity))}</span>
          </li>
        ))}
      </ul>
      {quote.discount_total_cents > 0 && (
        <div className="text-destructive flex justify-between border-t pt-2">
          <span>Discount</span>
          <span className="tabular-nums">−{formatRs(quote.discount_total_cents)}</span>
        </div>
      )}
      <div className="flex items-baseline justify-between border-t pt-2">
        <span className="font-semibold">Total</span>
        <span className="font-display text-4xl font-semibold tabular-nums" data-testid="quote-total">
          {formatRs(quote.charged_total_cents)}
        </span>
      </div>
      {changeDue !== null && changeDue > 0 && (
        <div className="bg-success-surface flex justify-between rounded-md px-3 py-2 text-lg font-semibold">
          <span>Change due</span>
          <span className="tabular-nums">{formatRs(changeDue)}</span>
        </div>
      )}
      {quote.commission_total_cents !== null && quote.commission_total_cents > 0 && (
        <div className="text-muted-foreground text-sm">
          Commission owed to {quote.operator_name}: {formatRs(quote.commission_total_cents)}
        </div>
      )}
      {quote.warnings.map((w) => (
        <Alert key={w} variant="warning">
          {w}
        </Alert>
      ))}
    </div>
  );
}
