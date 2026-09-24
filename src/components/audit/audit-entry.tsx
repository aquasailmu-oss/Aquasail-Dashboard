import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { describe, diffFields, tableLabel, type AuditAction, type AuditData } from "@/lib/audit";
import { formatDateTime } from "@/lib/dates";
import { ROLE_LABELS, type Role } from "@/lib/roles";

const ACTION = {
  INSERT: ["Created", "success"],
  UPDATE: ["Changed", "info"],
  DELETE: ["Removed", "destructive"],
} as const;

/** One audit entry: a sentence, who and when, and the field-by-field change on demand. */
export function AuditEntry({
  table,
  action,
  oldData,
  newData,
  changedAt,
  actor,
  actorRole,
  booking,
  names,
}: {
  table: string;
  action: AuditAction;
  oldData: AuditData;
  newData: AuditData;
  changedAt: string;
  actor: string;
  actorRole: string | null;
  booking?: { id: string; reference: string | null } | null;
  names?: { item?: string; operator?: string };
}) {
  const changes = diffFields(action, oldData, newData);
  const [label, variant] = ACTION[action];
  return (
    <details className="group border-b last:border-b-0">
      <summary className="hover:bg-secondary/50 grid min-h-11 cursor-pointer list-none grid-cols-1 gap-x-4 gap-y-1 px-4 py-2 md:grid-cols-[10rem_12rem_1fr_auto] md:items-center">
        <span className="text-muted-foreground text-sm whitespace-nowrap tabular-nums">
          {formatDateTime(changedAt)}
        </span>
        <span className="text-sm">
          <span className="font-semibold">{actor}</span>
          {actorRole && <span className="text-muted-foreground"> · {ROLE_LABELS[actorRole as Role] ?? actorRole}</span>}
        </span>
        <span>
          <Badge variant={variant} className="mr-2">
            {label}
          </Badge>
          <span className="text-muted-foreground mr-2 text-sm">{tableLabel(table)}</span>
          {describe(table, action, oldData, newData, names)}
        </span>
        <span className="text-sm whitespace-nowrap">
          {booking?.reference && (
            <Link href={`/bookings/${booking.id}`} className="text-accent-foreground font-mono hover:underline">
              {booking.reference}
            </Link>
          )}
        </span>
      </summary>
      <div className="bg-secondary/30 px-4 py-3">
        {changes.length === 0 ? (
          <p className="text-muted-foreground text-sm">No visible fields changed.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground text-left">
                <th className="py-1 pr-4 font-semibold">Field</th>
                {action !== "INSERT" && <th className="py-1 pr-4 font-semibold">Before</th>}
                {action !== "DELETE" && <th className="py-1 font-semibold">After</th>}
              </tr>
            </thead>
            <tbody>
              {changes.map((c) => (
                <tr key={c.field} className="border-t">
                  <td className="py-1 pr-4">{c.label}</td>
                  {action !== "INSERT" && (
                    <td className="text-muted-foreground py-1 pr-4 line-through decoration-1">{c.before}</td>
                  )}
                  {action !== "DELETE" && <td className="py-1 font-semibold">{c.after}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </details>
  );
}
