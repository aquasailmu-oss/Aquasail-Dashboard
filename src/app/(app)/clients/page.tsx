import { PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ClientSearch } from "@/components/clients/client-search";
import { PageHeader } from "@/components/shell/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth";
import { formatDateShort } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Clients · AquaSail Ops" };

const PAGE_SIZE = 25;

/** LIKE wildcards in what staff type are matched literally. */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const user = await requireRole(["admin", "accountant", "receptionist"]);
  const { q = "", page: pageParam } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);
  const canCreate = user.role !== "accountant";

  const supabase = await createClient();
  let query = supabase
    .from("client_summaries")
    .select("id, first_name, last_name, phone_e164, email, country, booking_count, last_visit", { count: "exact" });
  // Every word must appear somewhere in name, phone or email ("5700 1234", "priya ram").
  for (const token of q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5)) {
    query = query.ilike("search_text", `%${escapeLike(token)}%`);
  }
  const {
    data: clients,
    count,
    error,
  } = await query
    .order("last_name")
    .order("first_name")
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: number) => `/clients?${new URLSearchParams({ ...(q && { q }), page: String(p) })}`;

  return (
    <>
      <PageHeader
        title="Clients"
        description="Every customer, with their bookings. Search by name, phone or email."
        actions={
          canCreate && (
            <Button asChild>
              <Link href="/clients/new">
                <PlusIcon />
                New client
              </Link>
            </Button>
          )
        }
      />
      <div className="mb-4">
        <ClientSearch initial={q} />
      </div>
      {error ? (
        <Alert variant="destructive">Clients could not be loaded. Refresh the page to try again.</Alert>
      ) : clients.length === 0 ? (
        <Card className="text-muted-foreground p-10 text-center">
          {q ? `No client matches “${q}”.` : "No clients yet. They are added here or when a booking is made."}
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Country</TableHead>
                <TableHead className="text-right">Bookings</TableHead>
                <TableHead>Last visit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link
                      href={`/clients/${c.id}`}
                      className="text-accent-foreground inline-flex min-h-11 items-center font-semibold hover:underline"
                    >
                      {c.first_name} {c.last_name}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatPhone(c.phone_e164)}</TableCell>
                  <TableCell>{c.email}</TableCell>
                  <TableCell>{c.country}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.booking_count}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {c.last_visit ? formatDateShort(c.last_visit) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {pages > 1 && (
        <nav aria-label="Pages" className="mt-4 flex items-center gap-3">
          {page > 1 && (
            <Button asChild variant="outline" size="sm">
              <Link href={href(page - 1)}>Previous</Link>
            </Button>
          )}
          <span className="text-muted-foreground text-sm">
            Page {page} of {pages} · {total} clients
          </span>
          {page < pages && (
            <Button asChild variant="outline" size="sm">
              <Link href={href(page + 1)}>Next</Link>
            </Button>
          )}
        </nav>
      )}
    </>
  );
}
