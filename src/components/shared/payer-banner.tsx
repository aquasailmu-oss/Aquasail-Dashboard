import { BanknoteIcon, OctagonAlertIcon } from "lucide-react";

/**
 * What reception sees for an operator booking. "Do not collect" is a
 * business control, not decoration: this is where money gets lost, so it is
 * big, red and impossible to miss. Reused by the booking wizard (WP-15).
 */
export function PayerBanner({ operatorName, payer }: { operatorName: string; payer: "client" | "operator" }) {
  if (payer === "operator") {
    return (
      <div role="alert" className="bg-destructive flex items-center gap-4 rounded-md px-5 py-4 text-white">
        <OctagonAlertIcon className="size-9 shrink-0" aria-hidden />
        <div>
          <div className="font-display text-xl font-semibold tracking-wide uppercase">Do not collect payment</div>
          <div className="text-white/90">{operatorName} account. The operator pays AquaSail later.</div>
        </div>
      </div>
    );
  }
  return (
    <div className="border-success bg-success-surface flex items-center gap-3 rounded-md border-l-4 px-4 py-3">
      <BanknoteIcon className="text-success size-6 shrink-0" aria-hidden />
      <div>
        <span className="font-semibold">Customer pays at reception.</span>{" "}
        <span className="text-muted-foreground">Booked through {operatorName}.</span>
      </div>
    </div>
  );
}
