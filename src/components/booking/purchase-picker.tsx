"use client";

import { PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Stepper } from "@/components/booking/stepper";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { formatRs, type Cents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { type Participants, type Purchase, type WizardActivity, type WizardPackage } from "./purchase-utils";

const TYPES = ["adult", "child", "infant"] as const;
const EMPTY_PARTICIPANTS: Participants = { adult: 0, child: 0, infant: 0 };

function growBookingParty(purchase: Purchase, packages: WizardPackage[]): Purchase {
  const packageCounts = { adult: 0, child: 0, infant: 0 };
  for (const id of purchase.packageIds) {
    const pkg = packages.find((item) => item.id === id);
    if (!pkg) continue;
    for (const type of TYPES) {
      packageCounts[type] = Math.max(
        packageCounts[type],
        (purchase.packageParticipants[id]?.[type] ?? 0) * pkg.participants_per_unit,
      );
    }
  }
  const activityCounts = { adult: 0, child: 0, infant: 0 };
  for (const id of purchase.activityIds) {
    for (const type of TYPES) {
      activityCounts[type] = Math.max(activityCounts[type], purchase.activityParticipants[id]?.[type] ?? 0);
    }
  }
  const participants = { ...purchase.participants };
  for (const type of TYPES) {
    participants[type] = Math.max(participants[type], packageCounts[type], activityCounts[type]);
  }
  return { ...purchase, participants };
}

function PaxCounts({
  prefix,
  value,
  heading,
  labels,
  onChange,
}: {
  prefix: string;
  value: Participants;
  heading: string;
  labels?: Partial<Record<keyof Participants, string>>;
  onChange: (next: Participants) => void;
}) {
  return (
    <div className="border-t pt-2">
      <p className="text-muted-foreground mb-1 text-xs font-semibold tracking-wide uppercase">{heading}</p>
      {TYPES.map((type) => (
        <Stepper
          key={type}
          id={`${prefix}-${type}`}
          label={labels?.[type] ?? (type === "adult" ? "Adults" : type === "child" ? "Children" : "Infants")}
          hint={type === "child" ? "(2–11)" : type === "infant" ? "(under 2)" : undefined}
          value={value[type]}
          onChange={(count) => onChange({ ...value, [type]: count })}
        />
      ))}
    </div>
  );
}

/** Package quantities are sale units; activity quantities are participant entitlements. */
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
  const initialPax = value.participants;
  const togglePackage = (id: string) => {
    const selected = value.packageIds.includes(id);
    const packageParticipants = { ...value.packageParticipants };
    if (selected) delete packageParticipants[id];
    else {
      const pkg = packages.find((item) => item.id === id);
      packageParticipants[id] = pkg?.sale_unit === "package" ? { adult: 1, child: 0, infant: 0 } : { ...initialPax };
    }
    onChange(
      growBookingParty(
        {
          ...value,
          packageIds: selected ? value.packageIds.filter((x) => x !== id) : [...value.packageIds, id],
          packageParticipants,
        },
        packages,
      ),
    );
  };
  const updatePax = (kind: "package" | "activity", id: string, next: Participants) =>
    onChange(
      growBookingParty(
        {
          ...value,
          [kind === "package" ? "packageParticipants" : "activityParticipants"]: {
            ...(kind === "package" ? value.packageParticipants : value.activityParticipants),
            [id]: next,
          },
        },
        packages,
      ),
    );
  const addActivity = (id: string) => {
    onChange(
      growBookingParty(
        {
          ...value,
          activityIds: [...value.activityIds, id],
          activityParticipants: { ...value.activityParticipants, [id]: { ...initialPax } },
        },
        packages,
      ),
    );
    setAdding("");
  };
  const removeActivity = (id: string) => {
    const activityParticipants = { ...value.activityParticipants };
    delete activityParticipants[id];
    onChange({ ...value, activityIds: value.activityIds.filter((x) => x !== id), activityParticipants });
  };
  const setBookingCount = (type: keyof Participants) => (count: number) => {
    onChange({
      ...value,
      participants: { ...value.participants, [type]: count },
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="combo-packages-heading" className="flex flex-col gap-3">
        <h3 id="combo-packages-heading" className="font-semibold">
          Combo Packages
        </h3>
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="sr-only">Combo Packages</legend>
          {packages.map((p, i) => {
            const selected = value.packageIds.includes(p.id);
            const price = tilePrices[p.id];
            return (
              <div
                key={p.id}
                className={cn("rounded-md border-2 p-3", selected ? "border-primary bg-accent" : "border-border")}
              >
                <label className="relative flex cursor-pointer flex-col gap-1 pr-8">
                  <input type="checkbox" className="sr-only" checked={selected} onChange={() => togglePackage(p.id)} />
                  {i < 9 && (
                    <kbd className="bg-secondary text-muted-foreground absolute top-0 right-0 rounded px-2 py-0.5 text-sm font-semibold">
                      {i + 1}
                    </kbd>
                  )}
                  <span className="font-semibold">{p.name}</span>
                  {p.sale_unit === "package" && (
                    <span className="bg-secondary text-secondary-foreground w-fit rounded px-2 py-0.5 text-xs font-semibold">
                      1 package unit covers {p.participants_per_unit} people
                    </span>
                  )}
                  {p.includes.length > 0 && (
                    <span className="text-muted-foreground text-sm">
                      {p.includes
                        .map((item) => `${item.quantity > 1 ? `${item.quantity}× ` : ""}${item.name}`)
                        .join(" · ")}
                    </span>
                  )}
                  <span className={cn("text-sm font-semibold", price === null ? "text-warning" : "text-primary")}>
                    {price === undefined
                      ? " "
                      : price === null
                        ? "Price not set"
                        : `${formatRs(price)} / ${p.sale_unit === "package" ? "package unit" : "adult"}`}
                  </span>
                </label>
                {selected && (
                  <PaxCounts
                    prefix={`package-${p.id}`}
                    value={value.packageParticipants[p.id] ?? EMPTY_PARTICIPANTS}
                    heading={
                      p.sale_unit === "package" ? "Package units by price category" : "People purchasing this package"
                    }
                    labels={
                      p.sale_unit === "package"
                        ? { adult: "Adult-rate units", child: "Child-rate units", infant: "Infant-rate units" }
                        : undefined
                    }
                    onChange={(next) => updatePax("package", p.id, next)}
                  />
                )}
              </div>
            );
          })}
        </fieldset>
      </section>

      <section aria-labelledby="standalone-activities-heading" className="flex flex-col gap-3 border-t pt-5">
        <h3 id="standalone-activities-heading" className="font-semibold">
          Standalone Activities
        </h3>
        <div className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-2">
            <Label htmlFor="add-activity">Choose an activity or variant</Label>
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
          <Button type="button" variant="outline" disabled={!adding} onClick={() => addActivity(adding)}>
            <PlusIcon /> Add
          </Button>
        </div>
        {value.activityIds.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {value.activityIds.map((id) => {
              const activity = byActivity.get(id);
              return (
                <li key={id} className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold">{activity?.name ?? "Activity no longer on sale"}</span>
                    {activity && activity.participants_per_unit > 1 && (
                      <span className="text-muted-foreground text-sm">
                        {activity.participants_per_unit} participants per unit
                      </span>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${activity?.name ?? "activity"}`}
                      onClick={() => removeActivity(id)}
                    >
                      <XIcon />
                    </Button>
                  </div>
                  <PaxCounts
                    prefix={`activity-${id}`}
                    value={value.activityParticipants[id] ?? EMPTY_PARTICIPANTS}
                    heading="Participants for this activity"
                    onChange={(next) => updatePax("activity", id, next)}
                  />
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">No standalone activities selected.</p>
        )}
      </section>

      <section aria-labelledby="booking-participants-heading" className="border-t pt-4">
        <h3 id="booking-participants-heading" className="font-semibold">
          People on this booking
        </h3>
        <p className="text-muted-foreground text-sm">
          This is the unique guest count for waivers and boat capacity. Package units can cover several people; repeated
          activities do not add the same guests again. Increase this count if additional guests are joining.
        </p>
        {TYPES.map((type) => (
          <Stepper
            key={type}
            id={type === "adult" ? "adults" : type === "child" ? "children" : "infants"}
            label={type === "adult" ? "Adults" : type === "child" ? "Children" : "Infants"}
            hint={type === "child" ? "(2–11)" : type === "infant" ? "(under 2)" : undefined}
            value={value.participants[type]}
            onChange={setBookingCount(type)}
          />
        ))}
      </section>
    </div>
  );
}
