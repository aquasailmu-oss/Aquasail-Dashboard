"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateLong, formatTime } from "@/lib/dates";

type BookingEntry = {
  bookingId: string;
  reference: string;
  clientName: string;
  people: number;
  checkedIn: boolean;
  entitled: number;
};

type ActivityGroup = {
  time: string | null;
  activity: string;
  totalEntitled: number;
  checkedIn: number;
  pending: number;
  bookings: BookingEntry[];
};

export function OperationsView({
  date,
  groups,
}: {
  date: string;
  groups: ActivityGroup[];
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<string | null>(null);

  // Auto-refresh on focus
  if (typeof window !== "undefined") {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- safe: always runs in client
    useState(() => {
      const refresh = () => router.refresh();
      window.addEventListener("focus", refresh);
      const interval = setInterval(refresh, 30_000);
      return () => {
        window.removeEventListener("focus", refresh);
        clearInterval(interval);
      };
    });
  }

  const totalPeople = groups.reduce((s, g) => s + g.bookings.reduce((bs, b) => bs + b.people, 0), 0);
  const totalCheckedIn = groups.reduce((s, g) => s + g.checkedIn, 0);
  const totalPending = groups.reduce((s, g) => s + g.pending, 0);

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-semibold">Operations</h1>
        <p className="text-muted-foreground">{formatDateLong(date)}</p>
      </div>

      <div className="mb-6 grid grid-cols-3 gap-4">
        <StatCard label="People" value={totalPeople} />
        <StatCard label="Checked in" value={totalCheckedIn} variant={totalCheckedIn > 0 ? "success" : "default"} />
        <StatCard label="Pending" value={totalPending} variant={totalPending > 0 ? "warning" : "default"} />
      </div>

      {groups.length === 0 ? (
        <p className="text-muted-foreground p-10 text-center">No activities scheduled for today.</p>
      ) : (
        <div className="space-y-1">
          {groups.map((g) => {
            const key = `${g.time ?? "none"}::${g.activity}`;
            const isExpanded = expanded === key;
            const checkedInRatio = g.bookings.length > 0
              ? g.bookings.filter((b) => b.checkedIn).length / g.bookings.length
              : 0;

            return (
              <div key={key} className="rounded-lg border">
                <button
                  type="button"
                  onClick={() => setExpanded(isExpanded ? null : key)}
                  className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-muted/50 min-h-11"
                >
                  <span className="w-16 shrink-0 font-mono text-sm font-semibold tabular-nums">
                    {g.time ? formatTime(g.time) : "—"}
                  </span>
                  <span className="flex-1 font-semibold">{g.activity}</span>
                  <span className="tabular-nums font-semibold">{g.totalEntitled}</span>
                  <span className="text-muted-foreground text-sm">people</span>
                  <CheckInBar ratio={checkedInRatio} />
                </button>

                {isExpanded && (
                  <div className="border-t px-4 py-3 space-y-3">
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-success font-semibold">{g.checkedIn}</span> checked in
                      </div>
                      <div>
                        <span className="text-warning font-semibold">{g.pending}</span> pending
                      </div>
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-muted-foreground text-left text-xs">
                          <th className="pb-1">Reference</th>
                          <th className="pb-1">Client</th>
                          <th className="pb-1 text-right">People</th>
                          <th className="pb-1 text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.bookings.map((b) => (
                          <tr key={b.bookingId} className="border-t">
                            <td className="py-1.5 font-mono font-semibold">{b.reference}</td>
                            <td className="py-1.5">{b.clientName}</td>
                            <td className="py-1.5 text-right tabular-nums">{b.people}</td>
                            <td className="py-1.5 text-center">
                              {b.checkedIn ? (
                                <span className="text-success text-xs font-bold">CHECKED IN</span>
                              ) : (
                                <span className="text-muted-foreground text-xs">Pending</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  variant = "default",
}: {
  label: string;
  value: number;
  variant?: "default" | "success" | "warning";
}) {
  const color =
    variant === "success"
      ? "text-success"
      : variant === "warning"
        ? "text-warning"
        : "";
  return (
    <div className="rounded-lg border p-4 text-center">
      <div className={`text-3xl font-semibold tabular-nums ${color}`}>{value}</div>
      <div className="text-muted-foreground text-sm">{label}</div>
    </div>
  );
}

function CheckInBar({ ratio }: { ratio: number }) {
  return (
    <div className="h-2.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted" title={`${Math.round(ratio * 100)}% checked in`}>
      <div
        className="h-full rounded-full bg-success transition-all"
        style={{ width: `${ratio * 100}%` }}
      />
    </div>
  );
}
