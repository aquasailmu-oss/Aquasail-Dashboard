"use client";

import { useState, useTransition, type FormEvent } from "react";
import type { Result } from "@/lib/result";

/**
 * Submits a form to a Server Action without React's automatic form reset, so
 * nothing typed is lost when the action returns an error.
 */
export function useServerForm<T>(
  action: (formData: FormData) => Promise<Result<T>>,
  { onSuccess }: { onSuccess?: (data: T) => void } = {},
) {
  const [result, setResult] = useState<Result<T> | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const next = await action(formData);
      setResult(next);
      if (next.ok) onSuccess?.(next.data);
    });
  }

  return { result, pending, onSubmit, reset: () => setResult(null) };
}
