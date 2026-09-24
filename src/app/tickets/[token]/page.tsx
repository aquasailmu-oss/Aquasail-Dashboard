import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintControls } from "@/components/tickets/print-controls";
import { requireRole } from "@/lib/auth";
import { formatDateLong, formatTime } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { getTicket } from "@/lib/tickets";

export const metadata: Metadata = { title: "Ticket · AquaSail Ops" };

/**
 * The printable ticket, addressed by its token, not the booking id: the URL
 * is already what the V2 QR code will encode. V1 requires a staff session.
 * V2 adds a token-authenticated view for customers, so the token must stay
 * unguessable (16 random bytes) and must never be derived from the reference.
 */
export default async function TicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ print?: string }>;
}) {
  await requireRole(["admin", "receptionist"]);
  const [{ token }, { print }] = await Promise.all([params, searchParams]);
  const t = await getTicket(token);
  if (!t) notFound();

  return (
    <div className="ticket-page mx-auto flex max-w-[148mm] flex-col gap-4 px-4 py-6 print:max-w-none print:p-0">
      <style>{`
        @page { size: A5 portrait; margin: 9mm; }
        @media print {
          html, body { background: #fff !important; }
          .ticket-page { color: #000; }
        }
      `}</style>
      <PrintControls
        token={t.token}
        bookingHref={`/bookings/${t.bookingId}`}
        printedCount={t.printedCount}
        autoPrint={print === "1"}
        disabled={t.cancelled}
      />

      <article
        className="bg-card flex min-h-[190mm] flex-col gap-5 border p-6 text-black print:min-h-0 print:border-0 print:p-0"
        aria-label={`Ticket ${t.reference}`}
      >
        <header className="flex items-start justify-between gap-4 border-b-2 border-black pb-3">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element -- printed; plain img keeps it on paper */}
            <img
              src={t.logoPath ? `/branding/logo?v=${encodeURIComponent(t.logoPath)}` : "/aquasail-logo.svg"}
              alt={t.companyName}
              className="h-12 w-auto"
            />
            <div className="mt-1 text-sm font-semibold">{t.companyName}</div>
            {t.companyPhone && <div className="text-sm">{formatPhone(t.companyPhone) || t.companyPhone}</div>}
          </div>
          <div className="font-display text-right text-xl font-semibold tracking-widest">ACTIVITY TICKET</div>
        </header>

        {t.cancelled && (
          <div className="border-2 border-black p-3 text-center text-lg font-bold tracking-wide">
            CANCELLED: THIS TICKET IS NOT VALID
          </div>
        )}

        <section className="grid grid-cols-[1fr_auto] gap-5">
          <dl className="grid gap-2 text-base">
            <div>
              <dt className="text-xs font-semibold tracking-wide uppercase">Guest</dt>
              <dd className="text-lg font-semibold">{t.clientName}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold tracking-wide uppercase">Party</dt>
              <dd>{t.participants}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold tracking-wide uppercase">Date</dt>
              <dd className="font-semibold">
                {formatDateLong(t.serviceDate)}
                {t.departureTime && `, ${formatTime(t.departureTime)}`}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold tracking-wide uppercase">Meeting point</dt>
              <dd>{t.meetingPoint}</dd>
            </div>
            {t.boat && (
              <div>
                <dt className="text-xs font-semibold tracking-wide uppercase">Boat</dt>
                <dd>{t.boat}</dd>
              </div>
            )}
          </dl>
          {/* Reserved for the V2 QR code (it will encode this page's URL). Do not move. */}
          <div
            className="flex size-[34mm] flex-col items-center justify-center border-2 border-dashed border-black text-center"
            data-testid="qr-placeholder"
          >
            <span className="font-mono text-xs leading-tight font-semibold break-all">{t.reference}</span>
          </div>
        </section>

        <section>
          <h2 className="border-b border-black pb-1 text-xs font-semibold tracking-wide uppercase">
            {t.items.join(" + ")}
          </h2>
          <ul className="mt-2 grid gap-1">
            {t.entitlements.map((e) => (
              <li key={e.name} className="flex justify-between border-b border-dotted border-black/40 pb-1">
                <span>{e.name}</span>
                <span className="font-semibold tabular-nums">× {e.quantity}</span>
              </li>
            ))}
          </ul>
        </section>

        <div className="mt-auto text-center">
          <div className="text-xs font-semibold tracking-wide uppercase">Booking reference</div>
          <div className="font-mono text-3xl font-bold tracking-wider" data-testid="ticket-reference">
            {t.reference}
          </div>
          {t.footer && <p className="mt-3 text-sm">{t.footer}</p>}
        </div>
      </article>
    </div>
  );
}
