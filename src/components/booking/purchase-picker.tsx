"use client";

import { PlusIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Stepper } from "@/components/booking/stepper";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { unitsForParticipants } from "@/lib/activity-units";
import { formatRs, type Cents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { type Participants, type Purchase, type WizardActivity, type WizardPackage } from "./purchase-utils";

const TYPES = ["adult", "child", "infant"] as const;
const EMPTY_PARTICIPANTS: Participants = { adult: 0, child: 0, infant: 0 };

function PaxCounts({
  prefix,
  value,
  heading,
  labels,
  onChange,
  compact = false,
}: {
  prefix: string;
  value: Participants;
  heading: string;
  labels?: Partial<Record<keyof Participants, string>>;
  onChange: (next: Participants) => void;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "grid gap-2 border-t pt-2 sm:grid-cols-3" : "border-t pt-2"}>
      <p
        className={cn(
          "text-muted-foreground mb-1 text-xs font-semibold tracking-wide uppercase",
          compact && "sm:col-span-3",
        )}
      >
        {heading}
      </p>
      {TYPES.map((type) => (
        <Stepper
          key={type}
          id={`${prefix}-${type}`}
          label={labels?.[type] ?? (type === "adult" ? "Adults" : type === "child" ? "Children" : "Infants")}
          hint={type === "child" ? "(2–11)" : type === "infant" ? "(under 2)" : undefined}
          value={value[type]}
          onChange={(count) => onChange({ ...value, [type]: count })}
          compact={compact}
        />
      ))}
    </div>
  );
}

const countPeople = (pax: Participants) => pax.adult + pax.child + pax.infant;

function initialPackageUnits(people: Participants, guestsPerUnit: number): Participants {
  const ageGroupsPresent = TYPES.filter((type) => people[type] > 0);
  if (ageGroupsPresent.length !== 1) return { ...EMPTY_PARTICIPANTS };
  const type = ageGroupsPresent[0];
  return { ...EMPTY_PARTICIPANTS, [type]: Math.ceil(people[type] / guestsPerUnit) };
}

/** Package quantities are sale units; activity quantities are guest counts. */
export function PurchasePicker({
  packages,
  activities,
  tilePrices,
  showBookingGuests = false,
  presentParticipants,
  value,
  onChange,
}: {
  packages: WizardPackage[];
  activities: WizardActivity[];
  tilePrices: Record<string, Cents | null>;
  showBookingGuests?: boolean;
  /** Creation flow: new and uncustomized items follow actual guests present. */
  presentParticipants?: Participants;
  value: Purchase;
  onChange: (next: Purchase) => void;
}) {
  const [adding, setAdding] = useState("");
  const [manualCounts, setManualCounts] = useState<Set<string>>(() => new Set());
  const byActivity = new Map(activities.map((activity) => [activity.id, activity]));
  const initialPax = presentParticipants ?? value.participants;

  const updatePax = (kind: "package" | "activity", id: string, next: Participants) => {
    const isGuestCount = kind === "activity" || packages.find((pkg) => pkg.id === id)?.sale_unit === "participant";
    const participants = isGuestCount
      ? TYPES.reduce<Participants>(
          (safe, type) => ({
            ...safe,
            [type]: Math.min(next[type], initialPax[type]),
          }),
          { ...EMPTY_PARTICIPANTS },
        )
      : next;
    setManualCounts((current) => new Set(current).add(`${kind}:${id}`));
    onChange({
      ...value,
      [kind === "package" ? "packageParticipants" : "activityParticipants"]: {
        ...(kind === "package" ? value.packageParticipants : value.activityParticipants),
        [id]: participants,
      },
    });
  };

  const resetPax = (kind: "package" | "activity", id: string) => {
    setManualCounts((current) => {
      const next = new Set(current);
      next.delete(`${kind}:${id}`);
      return next;
    });
    onChange({
      ...value,
      [kind === "package" ? "packageParticipants" : "activityParticipants"]: {
        ...(kind === "package" ? value.packageParticipants : value.activityParticipants),
        [id]: { ...initialPax },
      },
    });
  };

  // Keep activities and per-guest packages matched to guests present until
  // staff deliberately changes an item's count. Package-unit products retain
  // explicit units because guest counts and sale units are not interchangeable.
  useEffect(() => {
    if (!presentParticipants) return;
    let packageParticipants = value.packageParticipants;
    let activityParticipants = value.activityParticipants;
    let changed = false;

    for (const id of value.packageIds) {
      const pkg = packages.find((item) => item.id === id);
      if (pkg?.sale_unit !== "participant") continue;
      const current = packageParticipants[id];
      const isManual = manualCounts.has(`package:${id}`);
      const next =
        isManual && current
          ? TYPES.reduce<Participants>(
              (safe, type) => ({ ...safe, [type]: Math.min(current[type], presentParticipants[type]) }),
              { ...EMPTY_PARTICIPANTS },
            )
          : { ...presentParticipants };
      if (!current || TYPES.some((type) => current[type] !== next[type])) {
        if (!changed) packageParticipants = { ...packageParticipants };
        packageParticipants[id] = next;
        changed = true;
      }
    }

    for (const id of value.activityIds) {
      const current = activityParticipants[id];
      const isManual = manualCounts.has(`activity:${id}`);
      const next =
        isManual && current
          ? TYPES.reduce<Participants>(
              (safe, type) => ({ ...safe, [type]: Math.min(current[type], presentParticipants[type]) }),
              { ...EMPTY_PARTICIPANTS },
            )
          : { ...presentParticipants };
      if (!current || TYPES.some((type) => current[type] !== next[type])) {
        if (!changed) activityParticipants = { ...activityParticipants };
        activityParticipants[id] = next;
        changed = true;
      }
    }

    if (changed) onChange({ ...value, packageParticipants, activityParticipants });
  }, [manualCounts, onChange, packages, presentParticipants, value]);

  const togglePackage = (id: string) => {
    const selected = value.packageIds.includes(id);
    const packageParticipants = { ...value.packageParticipants };
    setManualCounts((current) => {
      const next = new Set(current);
      next.delete(`package:${id}`);
      return next;
    });
    if (selected) delete packageParticipants[id];
    else {
      const pkg = packages.find((item) => item.id === id);
      packageParticipants[id] =
        pkg?.sale_unit === "package" ? initialPackageUnits(initialPax, pkg.participants_per_unit) : { ...initialPax };
    }
    onChange({
      ...value,
      packageIds: selected ? value.packageIds.filter((itemId) => itemId !== id) : [...value.packageIds, id],
      packageParticipants,
    });
  };

  const addActivity = (id: string) => {
    onChange({
      ...value,
      activityIds: [...value.activityIds, id],
      activityParticipants: { ...value.activityParticipants, [id]: { ...initialPax } },
    });
    setAdding("");
  };

  const removeActivity = (id: string) => {
    const activityParticipants = { ...value.activityParticipants };
    delete activityParticipants[id];
    setManualCounts((current) => {
      const next = new Set(current);
      next.delete(`activity:${id}`);
      return next;
    });
    onChange({ ...value, activityIds: value.activityIds.filter((itemId) => itemId !== id), activityParticipants });
  };

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="packages-heading" className="flex flex-col gap-3">
        <h3 id="packages-heading" className="font-semibold">
          Packages
        </h3>
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="sr-only">Packages</legend>
          {packages.map((pkg) => {
            const selected = value.packageIds.includes(pkg.id);
            const price = tilePrices[pkg.id];
            const quantities = value.packageParticipants[pkg.id] ?? EMPTY_PARTICIPANTS;
            const quantity = countPeople(quantities);
            const guestsCovered = pkg.sale_unit === "package" ? quantity * pkg.participants_per_unit : quantity;
            return (
              <div
                key={pkg.id}
                className={cn("rounded-md border-2 p-3", selected ? "border-primary bg-accent" : "border-border")}
              >
                <label className="relative flex cursor-pointer flex-col gap-1 pr-8">
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={selected}
                    onChange={() => togglePackage(pkg.id)}
                  />
                  <span className="font-semibold">{pkg.name}</span>
                  {pkg.sale_unit === "package" && (
                    <span className="bg-secondary text-secondary-foreground w-fit rounded px-2 py-0.5 text-xs font-semibold">
                      1 unit covers {pkg.participants_per_unit} guests
                    </span>
                  )}
                </label>
                {(pkg.description || pkg.includes.length > 0 || price !== undefined) && (
                  <details className="text-muted-foreground mt-2 text-sm">
                    <summary className="w-fit cursor-pointer font-medium">Package details and pricing</summary>
                    <div className="mt-2 flex flex-col gap-1">
                      {pkg.description && <p>{pkg.description}</p>}
                      {pkg.includes.length > 0 && (
                        <p>
                          <span className="font-semibold">Includes: </span>
                          {pkg.includes
                            .map((item) => `${item.quantity > 1 ? `${item.quantity}× ` : ""}${item.name}`)
                            .join(" · ")}{" "}
                          {pkg.sale_unit === "package" ? "per package unit" : "per guest"}
                        </p>
                      )}
                      {price === null ? (
                        <p className="text-warning font-semibold">Price not set</p>
                      ) : price !== undefined ? (
                        <p className="font-semibold">
                          {pkg.sale_unit === "package" ? "Package price" : "Adult price"}: {formatRs(price)}
                          {pkg.sale_unit === "package" ? " per unit" : " per guest"}
                        </p>
                      ) : null}
                    </div>
                  </details>
                )}
                {selected && (
                  <p className="bg-muted mt-2 rounded-md px-3 py-2 text-sm font-semibold">
                    {pkg.sale_unit === "package"
                      ? quantity > 0
                        ? `${quantity} ${quantity === 1 ? "unit" : "units"} · covers ${guestsCovered} guests`
                        : "Choose package units below"
                      : `${guestsCovered} guests included`}
                  </p>
                )}
                {selected && (
                  <details className="mt-2 border-t pt-2">
                    <summary className="w-fit cursor-pointer text-sm font-medium">
                      {pkg.sale_unit === "package" ? "Change package units" : "Change guests for this package"}
                    </summary>
                    <PaxCounts
                      prefix={`package-${pkg.id}`}
                      value={quantities}
                      heading={pkg.sale_unit === "package" ? "Package units to charge" : "Guests buying this package"}
                      labels={
                        pkg.sale_unit === "package"
                          ? { adult: "Adult units", child: "Child units", infant: "Infant units" }
                          : undefined
                      }
                      onChange={(next) => updatePax("package", pkg.id, next)}
                    />
                    {pkg.sale_unit === "participant" &&
                      manualCounts.has(`package:${pkg.id}`) &&
                      presentParticipants && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-2"
                          onClick={() => resetPax("package", pkg.id)}
                        >
                          Use all guests present
                        </Button>
                      )}
                  </details>
                )}
              </div>
            );
          })}
        </fieldset>
      </section>

      <section aria-labelledby="standalone-activities-heading" className="flex flex-col gap-3 border-t pt-5">
        <h3 id="standalone-activities-heading" className="font-semibold">
          Add individual activities
        </h3>
        <div className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-2">
            <Label htmlFor="add-activity">Choose an activity</Label>
            <select
              id="add-activity"
              className="border-input bg-card min-h-11 rounded-md border px-3"
              value={adding}
              onChange={(event) => setAdding(event.target.value)}
            >
              <option value="">Choose an activity…</option>
              {activities
                .filter((activity) => !value.activityIds.includes(activity.id))
                .map((activity) => (
                  <option key={activity.id} value={activity.id}>
                    {activity.name}
                  </option>
                ))}
            </select>
          </div>
          <Button type="button" variant="outline" disabled={!adding} onClick={() => addActivity(adding)}>
            <PlusIcon /> Add activity
          </Button>
        </div>
        {value.activityIds.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {value.activityIds.map((id) => {
              const activity = byActivity.get(id);
              const activityParticipants = value.activityParticipants[id] ?? EMPTY_PARTICIPANTS;
              const participantsAssigned = countPeople(activityParticipants);
              const activityUnits = activity
                ? unitsForParticipants(participantsAssigned, activity.participants_per_unit)
                : 0;
              const includedInPackages = activity
                ? packages.filter((pkg) => value.packageIds.includes(pkg.id) && pkg.codes.includes(activity.code))
                : [];
              return (
                <li key={id} className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold">{activity?.name ?? "Activity no longer on sale"}</span>
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
                  {includedInPackages.length > 0 && (
                    <Alert className="mt-3" variant="warning">
                      {activity?.name} is already included in {includedInPackages.map((pkg) => pkg.name).join(", ")}.
                      Adding it here creates a separate charge. Keep it only if the group needs more than the package
                      includes.
                    </Alert>
                  )}
                  <p className="bg-muted mt-3 rounded-md px-3 py-2 text-sm">
                    {activity && activity.participants_per_unit > 1
                      ? `${participantsAssigned} guests → ${activityUnits} ${activityUnits === 1 ? "unit" : "units"} (1 unit covers up to ${activity.participants_per_unit} guests)`
                      : `${participantsAssigned} guests taking part`}
                    {presentParticipants && !manualCounts.has(`activity:${id}`) && " · all guests present"}
                    {manualCounts.has(`activity:${id}`) && " · guest count changed"}
                  </p>
                  <details className="mt-2 border-t pt-2">
                    <summary className="w-fit cursor-pointer text-sm font-medium">Change who takes part</summary>
                    <PaxCounts
                      prefix={`activity-${id}`}
                      value={activityParticipants}
                      heading="Guests taking part"
                      onChange={(next) => updatePax("activity", id, next)}
                      compact
                    />
                    {manualCounts.has(`activity:${id}`) && presentParticipants && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-2"
                        onClick={() => resetPax("activity", id)}
                      >
                        Use all guests present
                      </Button>
                    )}
                  </details>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">
            No individual activities added. Add one only if the group wants an activity outside its packages.
          </p>
        )}
      </section>
      {showBookingGuests && (
        <section aria-labelledby="amend-booking-guests-heading" className="flex flex-col gap-3 border-t pt-5">
          <h3 id="amend-booking-guests-heading" className="font-semibold">
            Expected guests
          </h3>
          <p className="text-muted-foreground text-sm">
            This is the guest count recorded for the booking. The item counts show how many guests are assigned to each.
          </p>
          <PaxCounts
            prefix="amend-booking"
            value={value.participants}
            heading="Expected guests"
            onChange={(participants) => onChange({ ...value, participants })}
          />
        </section>
      )}
    </div>
  );
}
