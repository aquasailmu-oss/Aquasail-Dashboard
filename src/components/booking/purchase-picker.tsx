"use client";

import { PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Stepper } from "@/components/booking/stepper";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { formatRs, type Cents } from "@/lib/money";
import type { QuoteLineInput } from "@/lib/pricing/types";
import { cn } from "@/lib/utils";

export type WizardPackage = {
  id: string;
  name: string;
  description: string | null;
  includes: string[];
  codes: string[];
};
export type WizardActivity = { id: string; name: string; code: string };
export type Participants = { adult: number; child: number; infant: number };

/** What was bought: packages and standalone activities, each for every participant. */
export type Purchase = { packageIds: string[]; activityIds: string[]; participants: Participants };

export function purchaseLines({ packageIds, activityIds, participants }: Purchase): QuoteLineInput[] {
  const types = (["adult", "child", "infant"] as const).filter((t) => participants[t] > 0);
  const line = (target_type: "package" | "activity", target_id: string) =>
    types.map((t) => ({ target_type, target_id, participant_type: t, quantity: participants[t] }));
  return [...packageIds.flatMap((id) => line("package", id)), ...activityIds.flatMap((id) => line("activity", id))];
}

/** Anything including the catamaran (directly or in a package) needs a boat. */
export function purchaseNeedsBoat(
  purchase: Purchase,
  packages: WizardPackage[],
  activities: WizardActivity[],
): boolean {
  return (
    purchase.packageIds.some((id) => packages.find((p) => p.id === id)?.codes.includes("CATAMARAN")) ||
    purchase.activityIds.some((id) => activities.find((a) => a.id === id)?.code === "CATAMARAN")
  );
}

export const partySize = (p: Participants) => p.adult + p.child + p.infant;

/** Package tiles (1–9), standalone activities and participant counts. */
export function PurchasePicker({
  packages,
  activities,
  tilePrices,
  value,
  onChange,
}: {
  packages: WizardPackage[];
  activities: WizardActivity[];
  tilePrices: Record<string, Cents | null>;
  value: Purchase;
  onChange: (next: Purchase) => void;
}) {
  const [adding, setAdding] = useState("");
  const byActivity = new Map(activities.map((a) => [a.id, a]));
  const toggle = (id: string) =>
    onChange({
      ...value,
      packageIds: value.packageIds.includes(id) ? value.packageIds.filter((x) => x !== id) : [...value.packageIds, id],
    });
  const setCount = (type: keyof Participants) => (count: number) =>
    onChange({ ...value, participants: { ...value.participants, [type]: count } });

  return (
    <>
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="sr-only">Packages</legend>
        {packages.map((p, i) => {
          const selected = value.packageIds.includes(p.id);
          const price = tilePrices[p.id];
          return (
            <label
              key={p.id}
              className={cn(
                "has-focus-visible:outline-ring relative flex cursor-pointer flex-col gap-1 rounded-md border-2 p-3 pr-10 has-focus-visible:outline-3 has-focus-visible:outline-offset-2",
                selected ? "border-primary bg-accent" : "border-border",
              )}
            >
              <input type="checkbox" className="sr-only" checked={selected} onChange={() => toggle(p.id)} />
              {i < 9 && (
                <kbd className="bg-secondary text-muted-foreground absolute top-2 right-2 rounded px-2 py-0.5 text-sm font-semibold">
                  {i + 1}
                </kbd>
              )}
              <span className="font-semibold">{p.name}</span>
              {p.includes.length > 0 && <span className="text-muted-foreground text-sm">{p.includes.join(" · ")}</span>}
              <span className={cn("text-sm font-semibold", price === null ? "text-warning" : "text-primary")}>
                {price === undefined ? " " : price === null ? "Price not set" : `${formatRs(price)} / adult`}
              </span>
            </label>
          );
        })}
      </fieldset>

      {value.activityIds.length > 0 && (
        <ul className="flex flex-col gap-2">
          {value.activityIds.map((id) => (
            <li key={id} className="flex items-center justify-between rounded-md border px-3 py-1">
              <span className="font-semibold">{byActivity.get(id)?.name ?? "Activity no longer on sale"}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove ${byActivity.get(id)?.name ?? "activity"}`}
                onClick={() => onChange({ ...value, activityIds: value.activityIds.filter((x) => x !== id) })}
              >
                <XIcon />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="add-activity">Add a standalone activity</Label>
          <select
            id="add-activity"
            className="border-input bg-card min-h-11 rounded-md border px-3"
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
          >
            <option value="">Choose an activity…</option>
            {activities
              .filter((a) => !value.activityIds.includes(a.id))
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={!adding}
          onClick={() => {
            onChange({ ...value, activityIds: [...value.activityIds, adding] });
            setAdding("");
          }}
        >
          <PlusIcon /> Add
        </Button>
      </div>

      <div className="border-t pt-3">
        <Stepper id="adults" label="Adults" value={value.participants.adult} onChange={setCount("adult")} />
        <Stepper
          id="children"
          label="Children"
          hint="(2–11)"
          value={value.participants.child}
          onChange={setCount("child")}
        />
        <Stepper
          id="infants"
          label="Infants"
          hint="(under 2)"
          value={value.participants.infant}
          onChange={setCount("infant")}
        />
      </div>
    </>
  );
}
