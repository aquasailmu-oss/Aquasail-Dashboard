"use client";

import { SearchIcon } from "lucide-react";
import Link from "next/link";

import { useState, useTransition } from "react";
import { searchBookings, type BookingHit } from "@/actions/bookings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateShort } from "@/lib/dates";
import { openAfterSave } from "@/lib/navigate";

/** Find a booking by reference (the digits are enough), client name or phone; one match opens it. */
export function BookingSearch() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<BookingHit[] | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="relative w-full max-w-md">
      <form
        role="search"
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const r = await searchBookings(q);
            const found = r.ok ? r.data : [];
            if (found.length === 1) openAfterSave(`/bookings/${found[0].id}`);
            else setHits(found);
          });
        }}
      >
        <div className="relative flex-1">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2" />
          <Input
            type="search"
            aria-label="Find a booking by reference, client name or phone"
            placeholder="Reference, name or phone"
            className="pl-10"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setHits(null);
            }}
          />
        </div>
        <Button type="submit" variant="outline" disabled={pending || q.trim().length < 2}>
          Find
        </Button>
      </form>
      {hits && (
        <div className="bg-popover absolute z-20 mt-1 w-full rounded-md border shadow-md" role="status">
          {hits.length === 0 ? (
            <p className="text-muted-foreground p-3">No booking matches &ldquo;{q}&rdquo;.</p>
          ) : (
            <ul>
              {hits.map((h) => (
                <li key={h.id}>
                  <Link
                    href={`/bookings/${h.id}`}
                    className={`hover:bg-accent flex min-h-11 items-center justify-between gap-3 px-3 ${h.status === "cancelled" ? "line-through" : ""}`}
                  >
                    <span className="font-mono">{h.reference}</span>
                    <span className="truncate">{h.client_name}</span>
                    <span className="text-muted-foreground text-sm whitespace-nowrap">
                      {formatDateShort(h.service_date)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
