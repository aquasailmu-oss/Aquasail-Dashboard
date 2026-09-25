import type { Metadata } from "next";
import Link from "next/link";
import { AuditEntry } from "@/components/audit/audit-entry";
import { PageHeader } from "@/components/shell/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AUDITED_TABLES, tableLabel } from "@/lib/audit";
import { resolveAuditNames, type AuditRow } from "@/lib/audit-server";
import { requireRole } from "@/lib/auth";
import { addDays, businessDate, businessDayBounds, parseDateInput } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Audit log · AquaSail Ops" };

const PAGE_SIZE = 50;

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireRole(["admin", "accountant"]);
  const p = await searchParams;
  const today = businessDate();
  const to = (p.to && parseDateInput(p.to)) || today;
  const from = (p.from && parseDateInput(p.from)) || addDays(to, -6);
  const table = p.table && AUDITED_TABLES.includes(p.table) ? p.table : "";
  const action = p.action && ["INSERT", "UPDATE", "DELETE"].includes(p.action) ? p.action : "";
  const actor = p.actor && /^[0-9a-f-]{36}$/.test(p.actor) ? p.actor : "";
  const page = Math.max(1, Number.parseInt(p.page ?? "1", 10) || 1);

  const supabase = await createClient();
  let query = supabase
    .from("audit_logs")
    .select("id, table_name, record_id, action, actor_id, actor_role, changed_at, old_data, new_data", {
      count: "exact",
    })
    .gte("changed_at", businessDayBounds(from).start)
    .lt("changed_at", businessDayBounds(to).end);
  if (table) query = query.eq("table_name", table);
  if (action) query = query.eq("action", action);
  if (actor) query = query.eq("actor_id", actor);
  const { data, count, error } = await query
    .order("changed_at", { ascending: false })
    .order("id", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
    .overrideTypes<AuditRow[], { merge: false }>();
  if (error)
    return <Alert variant="destructive">The audit log could not be loaded. Refresh the page to try again.</Alert>;

  const { data: actors } = await supabase
    .from("audit_logs")
    .select("actor_id")
    .gte("changed_at", businessDayBounds(from).start)
    .lt("changed_at", businessDayBounds(to).end)
    .not("actor_id", "is", null)
    .limit(1000);
  const actorIds = [...new Set((actors ?? []).map((a) => a.actor_id).filter((x): x is string => !!x))];
  const { data: people } = actorIds.length ? await supabase.rpc("staff_names", { p_ids: actorIds }) : { data: [] };
  const names = await resolveAuditNames(supabase, data);
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const href = (n: number) =>
    `/admin/audit?${new URLSearchParams({ from, to, table, action, actor, page: String(n) })}`;

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every change to money, bookings, prices and settings: who, when, and exactly what changed."
      />
      <form className="bg-card mb-4 grid gap-3 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-6">
        <div className="flex flex-col gap-1">
          <Label htmlFor="from">From</Label>
          <Input id="from" name="from" type="date" defaultValue={from} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="to">To</Label>
          <Input id="to" name="to" type="date" defaultValue={to} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="table">Record type</Label>
          <select
            id="table"
            name="table"
            defaultValue={table}
            className="border-input bg-card min-h-11 rounded-md border px-3"
          >
            <option value="">All</option>
            {AUDITED_TABLES.map((t) => (
              <option key={t} value={t}>
                {tableLabel(t)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="action">Action</Label>
          <select
            id="action"
            name="action"
            defaultValue={action}
            className="border-input bg-card min-h-11 rounded-md border px-3"
          >
            <option value="">All</option>
            <option value="INSERT">Created</option>
            <option value="UPDATE">Changed</option>
            <option value="DELETE">Removed</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="actor">Who</Label>
          <select
            id="actor"
            name="actor"
            defaultValue={actor}
            className="border-input bg-card min-h-11 rounded-md border px-3"
          >
            <option value="">Anyone</option>
            {(people ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end gap-2">
          <Button type="submit" className="flex-1">
            Apply
          </Button>
          <Button asChild variant="ghost">
            <Link href="/admin/audit">Reset</Link>
          </Button>
        </div>
      </form>
      <p className="text-muted-foreground mb-2 text-sm">
        {count ?? 0} change{count === 1 ? "" : "s"}. Open an entry to see each field before and after.
      </p>
      <Card>
        {data.length === 0 ? (
          <p className="text-muted-foreground p-10 text-center">No changes match these filters.</p>
        ) : (
          data.map((r) => (
            <AuditEntry
              key={r.id}
              table={r.table_name}
              action={r.action}
              oldData={r.old_data}
              newData={r.new_data}
              changedAt={r.changed_at}
              actor={names.actor(r)}
              actorRole={r.actor_role}
              booking={names.booking(r)}
              names={names.names(r)}
            />
          ))
        )}
      </Card>
      {pages > 1 && (
        <nav aria-label="Pages" className="mt-4 flex items-center gap-3">
          {page > 1 && (
            <Button asChild variant="outline" size="sm">
              <Link href={href(page - 1)}>Newer</Link>
            </Button>
          )}
          <span className="text-muted-foreground text-sm">
            Page {page} of {pages}
          </span>
          {page < pages && (
            <Button asChild variant="outline" size="sm">
              <Link href={href(page + 1)}>Older</Link>
            </Button>
          )}
        </nav>
      )}
    </>
  );
}
