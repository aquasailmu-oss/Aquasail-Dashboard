import { fail, ok, type Result } from "@/lib/result";

export type SettlementModel = "net_rate" | "commission" | "none";
export type Payer = "client" | "operator";

/** Plain-language explanations, shown wherever an admin chooses these (build plan WP-12). */
export const SETTLEMENT_MODELS: Record<SettlementModel, { label: string; explanation: string }> = {
  net_rate: {
    label: "Net rate",
    explanation: "We charge the operator our net price. They add their own markup. Revenue is the net price.",
  },
  commission: {
    label: "Commission",
    explanation:
      "The customer pays our retail price and the operator earns a percentage. Revenue is retail; the commission is owed to the operator.",
  },
  none: { label: "None", explanation: "No special pricing. The customer pays our normal price." },
};

export const PAYERS: Record<Payer, { label: string; short: string }> = {
  client: { label: "Customer pays us at reception", short: "Customer pays" },
  operator: { label: "Operator pays us later (do not collect from the customer)", short: "Operator pays" },
};

/** 0.2 → "20%", 0.155 → "15.5%". */
export function formatRate(rate: number | null): string {
  if (rate === null) return "";
  return `${Number((rate * 100).toFixed(2))}%`;
}

/** "20" or "15.5" (%) → 0.2 / 0.155, computed via whole basis points so no float drift. */
export function parsePercent(value: string): Result<number> {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(value.replace(/\s|%/g, ""));
  if (!m) return fail("Enter the commission as a percentage, e.g. 20 or 15.5.");
  const basisPoints = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  if (basisPoints <= 0 || basisPoints > 10000) return fail("The commission must be more than 0% and at most 100%.");
  return ok(basisPoints / 10000);
}
