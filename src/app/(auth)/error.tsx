"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export default function AuthError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <Alert variant="warning">
        Sign-in is not responding just now. Check the internet connection and try again. If the internet is down, use
        the paper booking sheet and enter bookings later.
      </Alert>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
