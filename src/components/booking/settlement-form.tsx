"use client";

import { useActionState, useState } from "react";
import { saveSettlement } from "@/actions/settlement";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cents, formatRs } from "@/lib/money";
import { bookingShares } from "@/lib/settlement";

export function SettlementForm({
  booking,
  item = "",
  status,
  amount,
  reason = "",
  total = 0,
  editable,
}: {
  booking: string;
  item?: string;
  status: string;
  amount: number | null;
  reason?: string;
  total?: number;
  editable: boolean;
}) {
  const [message, action, saving] = useActionState(saveSettlement, "");
  const [choice, setChoice] = useState(status);
  const shares = item ? bookingShares(total, status === "manual", amount) : null;
  const options = item
    ? [
        ["automatic", "Standard 50/50"],
        ["manual", "Manual split"],
      ]
    : [
        ["none", "No adjustment"],
        ["pending", "Adjustment pending"],
        ["recorded", "Record adjustment"],
      ];
  return (
    <div className="space-y-2">
      {shares ? (
        <p className="text-sm">
          {shares.aquasail === null || shares.operator === null
            ? "Manual split pending"
            : `AquaSail ${formatRs(cents(shares.aquasail))} · Operator ${formatRs(cents(shares.operator))}`}
        </p>
      ) : (
        <p className="text-sm">
          {status === "recorded" && amount !== null
            ? `${formatRs(cents(amount))} · ${reason}`
            : status === "pending"
              ? "Adjustment pending"
              : "No adjustment recorded"}
        </p>
      )}
      {editable && (
        <form action={action} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="booking" value={booking} />
          <input type="hidden" name="item" value={item} />
          <label className="grid gap-1 text-sm">
            {item ? "Split" : "Adjustment status"}
            <select
              name="status"
              value={choice}
              onChange={(event) => setChoice(event.target.value)}
              className="border-input bg-card min-h-11 rounded-md border px-3"
            >
              {options.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {choice === "manual" || choice === "recorded" ? (
            <label className="grid gap-1 text-sm">
              {item ? "AquaSail share (Rs)" : "Adjustment (Rs, signed)"}
              <Input
                name="amount"
                inputMode="decimal"
                maxLength={20}
                defaultValue={amount === null ? "" : String(amount / 100)}
                required={!item}
              />
            </label>
          ) : (
            <input type="hidden" name="amount" value="" />
          )}
          {choice === "recorded" ? (
            <label className="grid gap-1 text-sm">
              Reason
              <Input name="reason" defaultValue={reason} maxLength={200} required />
            </label>
          ) : (
            <input type="hidden" name="reason" value="" />
          )}
          <Button type="submit" variant="outline" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <span role="status" className="text-sm">
            {message}
          </span>
        </form>
      )}
    </div>
  );
}
