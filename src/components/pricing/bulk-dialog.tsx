"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { applyBulkChange, previewBulkChange, type BulkInput, type BulkPreview } from "@/actions/pricing";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addDays, formatDateShort } from "@/lib/dates";
import { formatRs } from "@/lib/money";
import type { ParticipantType } from "./types";

/** A percentage change across a whole row or column: preview every change, then confirm. */
export function BulkDialog({
  title,
  axis,
  participantType,
  today,
  onClose,
}: {
  title: string;
  axis: BulkInput["axis"];
  participantType: ParticipantType;
  today: string;
  onClose: () => void;
}) {
  const [percent, setPercent] = useState("");
  const [from, setFrom] = useState(addDays(today, 1));
  const [preview, setPreview] = useState<BulkPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const input = { axis, participant_type: participantType, percent, effective_from: from };

  const run = (fn: () => Promise<void>) => {
    setError(null);
    startTransition(fn);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Adjust {title}</DialogTitle>
          <DialogDescription>
            Every current {participantType} price in {title} changes by the same percentage, rounded to the nearest
            rupee. You will see each change before anything is saved.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const r = await previewBulkChange(input);
              if (r.ok) setPreview(r.data);
              else {
                setPreview(null);
                setError(r.error);
              }
            });
          }}
        >
          {error && <Alert variant="destructive">{error}</Alert>}
          <div className="grid gap-5 sm:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="percent">Change (%)</Label>
              <Input
                id="percent"
                inputMode="decimal"
                placeholder="5 or -10"
                autoFocus
                value={percent}
                onChange={(e) => {
                  setPercent(e.target.value);
                  setPreview(null);
                }}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="bulk_from">Starts on</Label>
              <Input
                id="bulk_from"
                type="date"
                min={today}
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setPreview(null);
                }}
              />
            </div>
            <div className="flex items-end">
              <Button type="submit" variant="outline" disabled={pending} className="w-full">
                Preview changes
              </Button>
            </div>
          </div>
        </form>
        {preview && (
          <>
            {preview.changes.length === 0 ? (
              <Alert variant="warning">No current prices to change here.</Alert>
            ) : (
              <div className="max-h-80 overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>For</TableHead>
                      <TableHead className="text-right">Now</TableHead>
                      <TableHead className="text-right">From {formatDateShort(from)}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.changes.map((c) => (
                      <TableRow key={c.rule_id}>
                        <TableCell>{c.item}</TableCell>
                        <TableCell>{c.audience}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatRs(c.retail_from)}
                          {c.net_from !== null && (
                            <div className="text-muted-foreground text-sm">net {formatRs(c.net_from)}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {formatRs(c.retail_to)}
                          {c.net_to !== null && (
                            <div className="text-muted-foreground text-sm">net {formatRs(c.net_to)}</div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {preview.skipped.length > 0 && <Alert variant="warning">Not changed: {preview.skipped.join("; ")}.</Alert>}
          </>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            disabled={pending || !preview || preview.changes.length === 0}
            onClick={() =>
              run(async () => {
                if (!preview) return;
                const r = await applyBulkChange({ ...input, fingerprint: preview.fingerprint });
                if (!r.ok) return setError(r.error);
                toast.success(`${r.data} prices changed from ${formatDateShort(from)}.`);
                onClose();
              })
            }
          >
            {preview?.changes.length ? `Apply ${preview.changes.length} changes` : "Apply"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
