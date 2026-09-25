import type { Cents } from "@/lib/money";

export type ParticipantType = "adult" | "child" | "infant";

/** What reception chose; never a price. */
export type QuoteLineInput = {
  target_type: "package" | "activity";
  target_id: string;
  participant_type: ParticipantType;
  quantity: number;
};

/** Amount in cents, or percent in basis points (1000 = 10%). */
export type DiscountInput = { type: "amount" | "percent"; value: number; reason: string };

export type QuoteInput = {
  service_date: string;
  operator_id: string | null;
  lines: QuoteLineInput[];
  discount: DiscountInput | null;
};

export type QuoteLine = {
  line_type: "package" | "activity";
  package_id: string | null;
  activity_id: string | null;
  name: string;
  includes: string[];
  participant_type: ParticipantType;
  quantity: number;
  unit_retail_cents: Cents;
  unit_charged_cents: Cents;
  unit_operator_net_cents: Cents | null;
  commission_rate: number | null;
  /** Null when hidden from the viewer's role (reception never sees commission). */
  commission_cents: Cents | null;
  discount_cents: Cents;
  discount_reason: string | null;
  price_rule_id: string | null;
};

/**
 * A quote from the pricing engine (build_quote() in Postgres). Retail,
 * charged, net and commission are kept apart because accounting needs all
 * four. Operator net and commission are for admins and accountants only.
 */
export type Quote = {
  service_date: string;
  audience: "walk_in" | "operator";
  operator_id: string | null;
  operator_name: string | null;
  settlement_model: "net_rate" | "commission" | "none";
  payer: "client" | "operator";
  lines: QuoteLine[];
  retail_total_cents: Cents;
  charged_total_cents: Cents;
  discount_total_cents: Cents;
  /** Null when hidden from the viewer's role (reception never sees net or commission). */
  operator_net_total_cents: Cents | null;
  commission_total_cents: Cents | null;
  warnings: string[];
};
