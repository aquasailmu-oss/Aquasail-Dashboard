import { Badge } from "@/components/ui/badge";

const STATUS = {
  paid: { label: "Paid", variant: "success" },
  part_paid: { label: "Part paid", variant: "warning" },
  unpaid: { label: "Unpaid", variant: "destructive" },
  operator_account: { label: "Operator account", variant: "info" },
} as const;

export type PaymentStatus = keyof typeof STATUS;

export function PaymentStatusBadge({ status }: { status: string }) {
  const s = STATUS[status as PaymentStatus] ?? STATUS.unpaid;
  return <Badge variant={s.variant}>{s.label}</Badge>;
}
