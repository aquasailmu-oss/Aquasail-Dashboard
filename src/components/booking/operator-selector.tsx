"use client";

import { ArrowRightIcon, Building2Icon, CheckIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type BookingOperatorOption = {
  id: string;
  name: string;
  payer: "client" | "operator";
  logoUrl: string | null;
};

export function OperatorSelector({ operators }: { operators: BookingOperatorOption[] }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  function continueToBooking() {
    if (selectedId) router.push(`/bookings/new?operator=${encodeURIComponent(selectedId)}`);
  }

  return (
    <Card className="mx-auto max-w-5xl">
      <CardHeader className="pb-2">
        <CardTitle className="font-display text-2xl">Choose a tour operator</CardTitle>
        <CardDescription className="max-w-2xl text-base leading-relaxed">
          Select who sent this booking. We’ll use their pricing and payment arrangement on the booking.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {operators.length === 0 ? (
          <div className="bg-muted/50 text-muted-foreground rounded-lg border p-8 text-center">
            <Building2Icon className="text-muted-foreground mx-auto mb-3 size-8" aria-hidden />
            <p className="font-semibold">There are no active tour operators.</p>
            <p className="mt-1 text-sm">Ask an administrator to add or reactivate an operator before booking.</p>
          </div>
        ) : (
          <fieldset>
            <legend className="sr-only">Tour operator</legend>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {operators.map((operator) => {
                const selected = selectedId === operator.id;
                return (
                  <label
                    key={operator.id}
                    className={cn(
                      "group bg-card relative flex min-h-36 cursor-pointer items-center gap-4 rounded-xl border-2 p-4 shadow-sm transition",
                      "hover:border-primary/60 focus-within:ring-ring focus-within:ring-2 focus-within:ring-offset-2 hover:shadow-md",
                      selected ? "border-primary bg-accent/50 shadow-md" : "border-border",
                    )}
                  >
                    <input
                      className="accent-primary size-5 shrink-0"
                      type="radio"
                      name="tour_operator"
                      value={operator.id}
                      checked={selected}
                      onChange={() => setSelectedId(operator.id)}
                    />
                    <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-white p-2">
                      {operator.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- operator logos are stored in Supabase Storage
                        <img
                          src={operator.logoUrl}
                          alt={`${operator.name} logo`}
                          className="size-full object-contain"
                        />
                      ) : (
                        <Building2Icon className="text-primary/70 size-9" aria-hidden />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="block text-base leading-snug font-semibold">{operator.name}</span>
                      <span
                        className={cn(
                          "mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold",
                          operator.payer === "operator"
                            ? "bg-destructive/10 text-destructive"
                            : "bg-secondary text-secondary-foreground",
                        )}
                      >
                        {operator.payer === "operator" ? "Operator pays" : "Customer pays"}
                      </span>
                    </div>
                    <span
                      className={cn(
                        "absolute top-3 right-3 flex size-6 items-center justify-center rounded-full border",
                        selected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background text-transparent",
                      )}
                      aria-hidden
                    >
                      <CheckIcon className="size-4" />
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}
        <div className="flex justify-end border-t pt-5">
          <Button size="lg" disabled={!selectedId} onClick={continueToBooking}>
            Continue to booking
            <ArrowRightIcon />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
