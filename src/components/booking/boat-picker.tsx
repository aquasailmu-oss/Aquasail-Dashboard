"use client";

import { ShipIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type Boat = { id: string; name: string; capacity: number };

/**
 * Which vessel carries the group. Capacity is shown and warned about, never
 * enforced (hard capacity rules are V4).
 */
export function BoatPicker({
  boats,
  load,
  partySize,
  value,
  onChange,
}: {
  boats: Boat[];
  load: Record<string, number>;
  partySize: number;
  value: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <fieldset className="grid gap-3 sm:grid-cols-3">
      <legend className="sr-only">Boat</legend>
      {boats.map((b) => {
        const booked = load[b.id] ?? 0;
        const pct = Math.min(100, Math.round((booked / b.capacity) * 100));
        const over = booked + partySize > b.capacity;
        const selected = value === b.id;
        return (
          <label
            key={b.id}
            className={cn(
              "flex cursor-pointer flex-col gap-2 rounded-md border-2 p-3",
              selected ? "border-primary bg-accent" : "border-border",
            )}
          >
            <span className="flex items-center gap-2 font-semibold">
              <input
                type="radio"
                name="boat"
                value={b.id}
                checked={selected}
                onChange={() => onChange(b.id)}
                className="accent-primary size-5"
              />
              <ShipIcon className="size-4" aria-hidden />
              {b.name}
            </span>
            <span className="text-muted-foreground text-sm tabular-nums">
              {booked} / {b.capacity} booked
            </span>
            <span className="bg-muted h-2 overflow-hidden rounded-full" aria-hidden>
              <span
                className={cn("block h-full", pct >= 100 ? "bg-destructive" : "bg-brand-mid")}
                style={{ width: `${pct}%` }}
              />
            </span>
            {over && (
              <span className="text-destructive text-sm font-semibold">
                Adding {partySize} more would exceed capacity.
              </span>
            )}
          </label>
        );
      })}
    </fieldset>
  );
}
