"use client";

import { PrinterIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { markTicketPrinted } from "@/actions/tickets";
import { Button } from "@/components/ui/button";

/**
 * Prints straight to the printer dialog (never a PDF download). Every print,
 * including Ctrl+P, is counted so a reprint shows on the booking. With
 * ?print=1 the dialog opens on arrival: one click from the booking to paper.
 */
export function PrintControls({
  token,
  bookingHref,
  printedCount,
  autoPrint,
  disabled,
}: {
  token: string;
  bookingHref: string;
  printedCount: number;
  autoPrint: boolean;
  disabled: boolean;
}) {
  const [count, setCount] = useState(printedCount);

  useEffect(() => {
    if (disabled) return;
    const onBeforePrint = () => {
      markTicketPrinted(token).then((r) => r.ok && setCount(r.data));
    };
    window.addEventListener("beforeprint", onBeforePrint);
    if (autoPrint) {
      // Let the logo load first so it is on the paper. The cleanup cancels the
      // timer, so the dialog opens once even when the effect runs twice.
      const timer = setTimeout(() => window.print(), 300);
      return () => {
        clearTimeout(timer);
        window.removeEventListener("beforeprint", onBeforePrint);
      };
    }
    return () => window.removeEventListener("beforeprint", onBeforePrint);
  }, [token, autoPrint, disabled]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
      <Button asChild variant="outline">
        <Link href={bookingHref}>Back to the booking</Link>
      </Button>
      <span className="text-muted-foreground text-sm" data-testid="printed-count">
        {count === 0 ? "Not printed yet" : `Printed ${count} time${count === 1 ? "" : "s"}`}
      </span>
      <Button size="lg" autoFocus disabled={disabled} onClick={() => window.print()}>
        <PrinterIcon /> Print ticket
      </Button>
    </div>
  );
}
