"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { signIn } from "@/actions/auth";
import { SubmitButton } from "@/components/auth/submit-button";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState(signIn, null);
  // Controlled so the email survives a failed attempt (forms reset after an action).
  const [email, setEmail] = useState("");

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state && !state.ok && <Alert variant="destructive">{state.error}</Alert>}
      {next && <input type="hidden" name="next" value={next} />}
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
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <Label htmlFor="password">Password</Label>
          <Link
            href="/auth/forgot"
            className="text-accent-foreground inline-flex min-h-11 items-center text-sm font-semibold underline-offset-4 hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
    </form>
  );
}
