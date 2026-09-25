"use client";

import { useActionState } from "react";
import { updatePassword } from "@/actions/auth";
import { SubmitButton } from "@/components/auth/submit-button";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ResetForm() {
  const [state, action] = useActionState(updatePassword, null);

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state && !state.ok && <Alert variant="destructive">{state.error}</Alert>}
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          autoFocus
          required
          minLength={8}
        />
        <p className="text-muted-foreground text-sm">At least 8 characters.</p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="confirm">Type it again</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </div>
      <SubmitButton pendingLabel="Saving…">Save password and continue</SubmitButton>
    </form>
  );
}
