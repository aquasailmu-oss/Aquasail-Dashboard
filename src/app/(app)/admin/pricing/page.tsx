import type { Metadata } from "next";
import Link from "next/link";
import { PricingGrid } from "@/components/pricing/pricing-grid";
import {
  cellKey,
  type ParticipantType,
  type PricingCell,
  type PricingColumn,
  type PricingRow,
  type RuleSummary,
} from "@/components/pricing/types";
import { PageHeader } from "@/components/shell/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireRole } from "@/lib/auth";
import { businessDate, formatDateLong, parseDateInput } from "@/lib/dates";
import { cents } from "@/lib/money";
import type { SettlementModel } from "@/lib/operators";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Pricing · AquaSail Ops" };

const TYPES: { value: ParticipantType; label: string }[] = [
  { value: "adult", label: "Adult" },
  { value: "child", label: "Child" },
  { value: "infant", label: "Infant" },
];

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; date?: string }>;
}) {
  await requireRole(["admin"]);
  const params = await searchParams;
  const type: ParticipantType = TYPES.some((t) => t.value === params.type) ? (params.type as ParticipantType) : "adult";
  const today = businessDate();
  const asAt = (params.date && parseDateInput(params.date)) || today;

  const supabase = await createClient();
  const [activities, packages, operators, rules] = await Promise.all([
    supabase.from("activities").select("id, name").eq("is_active", true).order("sort_order").order("name"),
    supabase
      .from("packages")
      .select("id, name")
      .eq("is_active", true)
      .eq("pricing_mode", "bundle")
      .order("sort_order")
      .order("name"),
    supabase
      .from("tour_operators")
      .select("id, name, settlement_model, default_commission_rate")
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("price_rules")
      .select(
        "activity_id, package_id, operator_id, retail_cents, net_cents, commission_rate, effective_from, effective_to",
      )
      .eq("participant_type", type)
      .order("effective_from"),
  ]);
  if (activities.error || packages.error || operators.error || rules.error) {
    return <Alert variant="destructive">Prices could not be loaded. Refresh the page to try again.</Alert>;
  }

  const rows: PricingRow[] = [
    ...activities.data.map((a) => ({ scope: "activity" as const, id: a.id, name: a.name })),
    ...packages.data.map((p) => ({ scope: "package" as const, id: p.id, name: p.name })),
  ];
  const columns: PricingColumn[] = [
    { operatorId: null, name: "Walk-in", model: null, defaultRate: null },
    ...operators.data.map((o) => ({
      operatorId: o.id,
      name: o.name,
      model: o.settlement_model as SettlementModel,
      defaultRate: o.default_commission_rate,
    })),
  ];

  const cells: Record<string, PricingCell> = {};
  for (const r of rules.data) {
    const key = `${r.activity_id ? "activity" : "package"}:${r.activity_id ?? r.package_id}:${r.operator_id ?? "walk_in"}`;
    const summary: RuleSummary = {
      retail: cents(r.retail_cents),
      net: r.net_cents === null ? null : cents(r.net_cents),
      rate: r.commission_rate,
      from: r.effective_from,
      to: r.effective_to,
    };
    const cell = (cells[key] ??= { current: null, next: null, open: null });
    if (r.effective_from <= asAt && (r.effective_to === null || r.effective_to > asAt)) cell.current = summary;
    if (r.effective_from > asAt && (!cell.next || r.effective_from < cell.next.from)) cell.next = summary;
    if (r.effective_to === null) cell.open = summary;
  }
  const missing = rows.filter((row) => !cells[cellKey(row, columns[0])]?.current).length;
  const typeHref = (t: ParticipantType) =>
    `/admin/pricing?${new URLSearchParams({ type: t, ...(asAt !== today && { date: asAt }) })}`;

  return (
    <>
      <PageHeader
        title="Pricing"
        description="Prices are never overwritten: a change closes the current price and starts a new one on a date you choose."
      />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <nav aria-label="Participant type" className="bg-secondary flex gap-1 rounded-md p-1">
          {TYPES.map((t) => (
            <Link
              key={t.value}
              href={typeHref(t.value)}
              aria-current={t.value === type ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center rounded-md px-5 font-semibold",
                t.value === type ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <form className="flex items-end gap-2">
          <input type="hidden" name="type" value={type} />
          <div className="flex flex-col gap-1">
            <Label htmlFor="date">Prices as at</Label>
            <Input id="date" name="date" type="date" defaultValue={asAt} className="w-44" />
          </div>
          <Button type="submit" variant="outline">
            Show
          </Button>
          {asAt !== today && (
            <Button asChild variant="ghost">
              <Link href={`/admin/pricing?type=${type}`}>Today</Link>
            </Button>
          )}
        </form>
      </div>
      {asAt !== today && (
        <Alert className="mb-4">
          Showing prices as they {asAt < today ? "were" : "will be"} on {formatDateLong(asAt)}.
        </Alert>
      )}
      {missing > 0 && (
        <Alert variant="warning" className="mb-4">
          {missing} {missing === 1 ? "item has" : "items have"} no walk-in {type} price on this date. Reception cannot
          sell
          {missing === 1 ? " it" : " them"} for {type === "adult" || type === "infant" ? "an" : "a"} {type} until{" "}
          {missing === 1 ? "it is" : "they are"} set.
        </Alert>
      )}
      {rows.length === 0 ? (
        <Alert>No active activities or bundle-priced packages yet. Add them under Activities and Packages.</Alert>
      ) : (
        <PricingGrid rows={rows} columns={columns} cells={cells} participantType={type} today={today} />
      )}
    </>
  );
}
