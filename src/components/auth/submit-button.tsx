"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

/** Full-width primary submit that shows progress and blocks a double submit. */
export function SubmitButton({ children, pendingLabel }: { children: React.ReactNode; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending} aria-disabled={pending}>
      {pending ? pendingLabel : children}
    </Button>
  );
}
