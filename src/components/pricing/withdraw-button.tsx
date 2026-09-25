"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { withdrawScheduledPrice } from "@/actions/pricing";
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

/** Withdraw a scheduled (not yet started) price, e.g. to fix a typo before it applies. */
export function WithdrawButton({ ruleId, summary }: { ruleId: string; summary: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Withdraw
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setError(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Withdraw this scheduled price?</DialogTitle>
            <DialogDescription>{summary}</DialogDescription>
          </DialogHeader>
          <p>
            It has not started and no booking uses it. The price before it carries on instead. The withdrawal is kept in
            the audit log.
          </p>
          {error && <Alert variant="destructive">{error}</Alert>}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Keep it
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const r = await withdrawScheduledPrice(ruleId);
                  if (!r.ok) return setError(r.error);
                  setOpen(false);
                  toast.success("Scheduled price withdrawn.");
                })
              }
            >
              Withdraw price
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
