"use client";

import { PrinterIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <Button type="button" onClick={() => window.print()}>
      <PrinterIcon /> {label}
    </Button>
  );
}
