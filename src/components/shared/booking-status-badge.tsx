import { Badge } from "@/components/ui/badge";
import type { Database } from "@/lib/database.types";

type Status = Database["public"]["Enums"]["booking_status"];

const STATUS: Record<Status, { label: string; variant: "success" | "secondary" | "warning" | "destructive" }> = {
  confirmed: { label: "Confirmed", variant: "success" },
  completed: { label: "Completed", variant: "secondary" },
  no_show: { label: "No-show", variant: "warning" },
  cancelled: { label: "Cancelled", variant: "destructive" },
};

export function BookingStatusBadge({ status }: { status: Status }) {
  const { label, variant } = STATUS[status];
  return <Badge variant={variant}>{label}</Badge>;
}
