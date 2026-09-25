import type { Cents } from "@/lib/money";
import type { SettlementModel } from "@/lib/operators";

export type ParticipantType = "adult" | "child" | "infant";

export type PricingRow = { scope: "activity" | "package"; id: string; name: string };

export type PricingColumn = {
  operatorId: string | null;
  name: string;
  model: SettlementModel | null;
  defaultRate: number | null;
};

export type RuleSummary = {
  retail: Cents;
  net: Cents | null;
  rate: number | null;
  from: string;
  to: string | null;
};

export type PricingCell = {
  /** The rule in force on the "as at" date. */
  current: RuleSummary | null;
  /** The next rule starting after the "as at" date, if any. */
  next: RuleSummary | null;
  /** The open-ended rule a new price would close (what set_price replaces). */
  open: RuleSummary | null;
};

export const cellKey = (row: PricingRow, column: PricingColumn) =>
  `${row.scope}:${row.id}:${column.operatorId ?? "walk_in"}`;
