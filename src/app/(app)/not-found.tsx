import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 py-10">
      <h1 className="font-display text-2xl font-semibold">Not found</h1>
      <p className="text-muted-foreground">
        That record does not exist, or the link is wrong. Bookings are never deleted, so check the reference and search
        again.
      </p>
      <div className="flex gap-3">
        <Button asChild>
          <Link href="/today">Go to Today</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/bookings">Search bookings</Link>
        </Button>
      </div>
    </div>
  );
}
