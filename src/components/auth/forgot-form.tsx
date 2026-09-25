"use client";

import { useActionState, useState } from "react";
import { requestPasswordReset } from "@/actions/auth";
import { SubmitButton } from "@/components/auth/submit-button";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ForgotForm() {
  const [state, action] = useActionState(requestPasswordReset, null);
  const [email, setEmail] = useState("");

  if (state?.ok) return <Alert variant="success">{state.data}</Alert>;

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state && !state.ok && <Alert variant="destructive">{state.error}</Alert>}
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          autoFocus
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <SubmitButton pendingLabel="Sending…">Email me a reset link</SubmitButton>
    </form>
  );
}
