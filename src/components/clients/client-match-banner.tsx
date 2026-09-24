"use client";

import { UserCheckIcon } from "lucide-react";
import type { ClientMatch } from "@/actions/clients";
import { Button } from "@/components/ui/button";
import { formatDateShort } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";

function visits(match: ClientMatch): string {
  const count = `${match.booking_count} previous booking${match.booking_count === 1 ? "" : "s"}`;
  return match.last_visit ? `${count} · last visit ${formatDateShort(match.last_visit)}` : count;
}

/**
 * "Existing customer found": shown while a client's details are typed, so
 * reception reuses the record instead of creating a duplicate. Page-agnostic:
 * the caller decides what "use" means (open the record, or fill a booking).
 */
export function ClientMatchBanner({
  matches,
  onUse,
  useLabel = "Use this client",
}: {
  matches: readonly ClientMatch[];
  onUse: (match: ClientMatch) => void;
  useLabel?: string;
}) {
  if (matches.length === 0) return null;
  const high = matches.some((m) => m.confidence === "high");

  return (
    <section
      aria-live="polite"
      aria-label="Existing customer found"
      className={cn(
        "rounded-md border-l-4 px-4 py-3",
        high ? "border-success bg-success-surface" : "border-warning bg-warning-surface",
      )}
    >
      <div className="mb-2 flex items-center gap-2 font-semibold">
        <UserCheckIcon className="size-5" aria-hidden />
        {high ? "Existing customer found" : "Possibly an existing customer"}
      </div>
      <ul className="flex flex-col gap-2">
        {matches.map((m) => (
          <li
            key={m.id}
            className="bg-card flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2"
          >
            <div className="min-w-0">
              <div className="font-semibold">
                {m.first_name} {m.last_name}
                <span className="text-muted-foreground ml-2 text-sm font-normal">{m.match_reason}</span>
              </div>
              <div className="text-muted-foreground text-sm">
                {[formatPhone(m.phone_e164), m.email].filter(Boolean).join(" · ")}
              </div>
              <div className="text-sm">{visits(m)}</div>
            </div>
            <Button
              type="button"
              size="sm"
              variant={m.confidence === "high" ? "default" : "outline"}
              onClick={() => onUse(m)}
            >
              {useLabel}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
