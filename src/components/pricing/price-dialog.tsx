"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setPrice } from "@/actions/pricing";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addDays, formatDateShort, parseDateInput } from "@/lib/dates";
import { cents, formatRs, fromCents, toCents } from "@/lib/money";
import { formatRate } from "@/lib/operators";
import type { ParticipantType, PricingCell, PricingColumn, PricingRow } from "./types";

const TYPE_LABEL: Record<ParticipantType, string> = { adult: "adult", child: "child", infant: "infant" };

function tryRupees(value: string) {
  try {
    return value.trim() ? toCents(value) : null;
  } catch {
    return null;
  }
}

export function PriceDialog({
  row,
  column,
  cell,
  participantType,
  today,
  onClose,
}: {
  row: PricingRow;
  column: PricingColumn;
  cell: PricingCell;
  participantType: ParticipantType;
  today: string;
  onClose: () => void;
}) {
  const open = cell.open;
  const [retail, setRetail] = useState(open ? String(fromCents(open.retail)) : "");
  const [net, setNet] = useState(open?.net !== null && open?.net !== undefined ? String(fromCents(open.net)) : "");
  const [rate, setRate] = useState(open?.rate ? String(Number((open.rate * 100).toFixed(2))) : "");
  const [from, setFrom] = useState(addDays(today, 1));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const newRetail = tryRupees(retail);
  const validFrom = parseDateInput(from);
  const audience = column.operatorId ? column.name : "walk-in";
  const sentence =
    newRetail !== null && validFrom
      ? `${row.name}, ${TYPE_LABEL[participantType]}, ${audience}: ` +
        (open && open.from < validFrom
          ? `${formatRs(open.retail)} until ${formatDateShort(addDays(validFrom, -1))}, then `
          : "") +
        `${formatRs(cents(newRetail))} from ${formatDateShort(validFrom)}.`
      : null;

  function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await setPrice({
        scope: row.scope,
        target_id: row.id,
        operator_id: column.operatorId,
        participant_type: participantType,
        retail,
        net: column.model === "net_rate" ? net : "",
        commission_percent: column.model === "commission" ? rate : "",
        effective_from: from,
      });
      if (!result.ok) return setError(result.error);
      toast.success(sentence ?? "Price saved.");
      onClose();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {row.name} · {TYPE_LABEL[participantType]} · {audience}
          </DialogTitle>
          <DialogDescription>
            {open
              ? `Current price ${formatRs(open.retail)} since ${formatDateShort(open.from)}.`
              : "No price is set yet."}{" "}
            The current price is closed and a new one starts; nothing is overwritten.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="flex flex-col gap-5" noValidate>
          {error && <Alert variant="destructive">{error}</Alert>}
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="retail">Retail price (Rs)</Label>
              <Input
                id="retail"
                inputMode="decimal"
                autoFocus
                value={retail}
                onChange={(e) => setRetail(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="effective_from">Starts on</Label>
              <Input
                id="effective_from"
                type="date"
                min={today}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            {column.model === "net_rate" && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="net">Net price to {column.name} (Rs)</Label>
                <Input id="net" inputMode="decimal" value={net} onChange={(e) => setNet(e.target.value)} />
                <p className="text-muted-foreground text-sm">
                  What AquaSail earns. Without it, the retail price is charged.
                </p>
              </div>
            )}
            {column.model === "commission" && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="rate">Commission (%)</Label>
                <Input
                  id="rate"
                  inputMode="decimal"
                  placeholder={`${formatRate(column.defaultRate)} (operator default)`}
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                />
                <p className="text-muted-foreground text-sm">Leave empty to use the operator&rsquo;s default.</p>
              </div>
            )}
          </div>
          {sentence && <Alert>{sentence}</Alert>}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save price"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
