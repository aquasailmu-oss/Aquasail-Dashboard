"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Any unexpected failure inside the app: a message staff can act on, never a stack trace. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 py-10">
      <h1 className="font-display text-2xl font-semibold">Something went wrong on this screen</h1>
      <Alert variant="warning">
        Nothing you saved before this was lost. Try again; if it keeps happening, check the internet connection, then
        tell an admin what you were doing{error.digest ? ` and quote the code ${error.digest}` : ""}.
      </Alert>
      <div className="flex gap-3">
        <Button onClick={reset}>Try again</Button>
        <Button asChild variant="outline">
          <Link href="/today">Go to Today</Link>
        </Button>
      </div>
    </div>
  );
}
