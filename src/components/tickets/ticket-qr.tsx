import { qrSvgPath } from "@/lib/qr";

/**
 * The ticket's QR code, drawn crisp at any print size. The same path is
 * drawn into the PDF by the /tickets/[token]/pdf route.
 */
export function TicketQr({ url, className }: { url: string; className?: string }) {
  const { size, path } = qrSvgPath(url);
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      role="img"
      aria-label="Ticket QR code"
      shapeRendering="crispEdges"
      data-testid="ticket-qr"
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
