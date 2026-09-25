"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
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
import type { Result } from "@/lib/result";

/**
 * Deactivate / reactivate a catalogue row. Nothing is ever deleted. When
 * deactivating affects something else (an activity inside active packages),
 * the caller passes `affected` and the admin confirms having seen the list.
 */
export function ActiveToggle({
  id,
  name,
  isActive,
  action,
  affected = [],
  affectedLabel = "",
}: {
  id: string;
  name: string;
  isActive: boolean;
  action: (formData: FormData) => Promise<Result<null>>;
  affected?: string[];
  affectedLabel?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  function run() {
    const formData = new FormData();
    formData.set("id", id);
    formData.set("is_active", String(!isActive));
    startTransition(async () => {
      const result = await action(formData);
      setConfirming(false);
      if (result.ok) toast.success(`${name} ${isActive ? "deactivated" : "reactivated"}.`);
      else toast.error(result.error);
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        aria-label={`${isActive ? "Deactivate" : "Reactivate"} ${name}`}
        onClick={() => (isActive && affected.length > 0 ? setConfirming(true) : run())}
      >
        {isActive ? "Deactivate" : "Reactivate"}
      </Button>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deactivate {name}?</DialogTitle>
            <DialogDescription>{affectedLabel}</DialogDescription>
          </DialogHeader>
          <ul className="list-disc pl-6">
            {affected.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
          <p className="text-muted-foreground text-sm">
            Nothing is deleted. Past bookings are unchanged, and you can reactivate it at any time.
          </p>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Keep it active
              </Button>
            </DialogClose>
            <Button type="button" variant="destructive" disabled={pending} onClick={run}>
              Deactivate anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
