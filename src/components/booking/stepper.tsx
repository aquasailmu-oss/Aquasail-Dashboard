"use client";

import { MinusIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/** A count with − / + buttons; the number itself is a typed input for speed. */
export function Stepper({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const set = (v: number) => onChange(Math.max(0, Math.min(500, v)));
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <label htmlFor={id} className="font-semibold">
        {label}
        {hint && <span className="text-muted-foreground ml-1 text-sm font-normal">{hint}</span>}
      </label>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon"
          tabIndex={-1}
          aria-label={`Fewer ${label.toLowerCase()}`}
          onClick={() => set(value - 1)}
        >
          <MinusIcon />
        </Button>
        <input
          id={id}
          inputMode="numeric"
          className="border-input bg-card min-h-11 w-16 rounded-md border text-center text-lg font-semibold tabular-nums"
          value={value}
          onFocus={(e) => e.target.select()}
          onChange={(e) => set(Number.parseInt(e.target.value.replace(/\D/g, ""), 10) || 0)}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp") {
              e.preventDefault();
              set(value + 1);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              set(value - 1);
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          tabIndex={-1}
          aria-label={`More ${label.toLowerCase()}`}
          onClick={() => set(value + 1)}
        >
          <PlusIcon />
        </Button>
      </div>
    </div>
  );
}
