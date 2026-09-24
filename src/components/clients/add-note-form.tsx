"use client";

import { useRef } from "react";
import { toast } from "sonner";
import { addClientNote } from "@/actions/clients";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useServerForm } from "@/lib/use-server-form";

export function AddNoteForm({ clientId }: { clientId: string }) {
  const form = useRef<HTMLFormElement>(null);
  const { result, pending, onSubmit } = useServerForm(addClientNote, {
    onSuccess: () => {
      form.current?.reset();
      toast.success("Note added.");
    },
  });

  return (
    <form ref={form} onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      {result && !result.ok && <Alert variant="destructive">{result.error}</Alert>}
      <input type="hidden" name="client_id" value={clientId} />
      <Label htmlFor="note">Add a note</Label>
      <Textarea id="note" name="note" placeholder="Dated and signed with your name automatically." />
      <div>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Saving…" : "Add note"}
        </Button>
      </div>
    </form>
  );
}
