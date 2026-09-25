"use client";

import { HistoryIcon, SlidersHorizontalIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateShort } from "@/lib/dates";
import { formatRs } from "@/lib/money";
import { formatRate } from "@/lib/operators";
import { cn } from "@/lib/utils";
import { BulkDialog } from "./bulk-dialog";
import { PriceDialog } from "./price-dialog";
import { cellKey, type ParticipantType, type PricingCell, type PricingColumn, type PricingRow } from "./types";

type Editing = { row: PricingRow; column: PricingColumn } | null;
type Bulk = { title: string; axis: Parameters<typeof BulkDialog>[0]["axis"] } | null;

const EMPTY: PricingCell = { current: null, next: null, open: null };

function CellContent({ cell, column }: { cell: PricingCell; column: PricingColumn }) {
  const c = cell.current;
  if (!c) {
    if (!column.operatorId) {
      return (
        <span className="text-warning inline-flex items-center gap-1 font-semibold">
          <TriangleAlertIcon className="size-4" /> Not set
        </span>
      );
    }
    return (
      <span className="flex flex-col items-end">
        <span className="text-muted-foreground">Walk-in price</span>
        {column.model === "net_rate" && <span className="text-warning text-sm font-semibold">no net price</span>}
      </span>
    );
  }
  return (
    <span className="flex flex-col items-end">
      <span className="font-semibold tabular-nums">{formatRs(c.retail)}</span>
      {column.model === "net_rate" &&
        (c.net !== null ? (
          <span className="text-muted-foreground text-sm tabular-nums">net {formatRs(c.net)}</span>
        ) : (
          <span className="text-warning text-sm font-semibold">no net price</span>
        ))}
      {column.model === "commission" && (
        <span className="text-muted-foreground text-sm">{formatRate(c.rate ?? column.defaultRate)} commission</span>
      )}
    </span>
  );
}

export function PricingGrid({
  rows,
  columns,
  cells,
  participantType,
  today,
}: {
  rows: PricingRow[];
  columns: PricingColumn[];
  cells: Record<string, PricingCell>;
  participantType: ParticipantType;
  today: string;
}) {
  const [editing, setEditing] = useState<Editing>(null);
  const [bulk, setBulk] = useState<Bulk>(null);
  const sections = [
    { title: "Activities", rows: rows.filter((r) => r.scope === "activity") },
    { title: "Packages with their own price", rows: rows.filter((r) => r.scope === "package") },
  ];

  return (
    <>
      <div className="bg-card overflow-x-auto rounded-lg border shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="bg-muted sticky left-0 z-10">Item</TableHead>
              {columns.map((col) => (
                <TableHead key={col.operatorId ?? "walk_in"} className="text-right align-bottom">
                  <div className="font-semibold">{col.name}</div>
                  {col.model && (
                    <div className="text-muted-foreground text-xs font-normal">
                      {col.model === "net_rate" ? "net rate" : col.model}
                    </div>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-1"
                    aria-label={`Adjust all ${col.name} prices`}
                    onClick={() =>
                      setBulk({
                        title: `the ${col.name} column`,
                        axis: { kind: "column", operator_id: col.operatorId },
                      })
                    }
                  >
                    <SlidersHorizontalIcon /> Adjust
                  </Button>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sections.map((section) =>
              section.rows.length === 0 ? null : (
                <SectionRows
                  key={section.title}
                  title={section.title}
                  rows={section.rows}
                  columns={columns}
                  cells={cells}
                  onEdit={(row, column) => setEditing({ row, column })}
                  onBulk={(row) =>
                    setBulk({ title: row.name, axis: { kind: "row", scope: row.scope, target_id: row.id } })
                  }
                />
              ),
            )}
          </TableBody>
        </Table>
      </div>
      {editing && (
        <PriceDialog
          row={editing.row}
          column={editing.column}
          cell={cells[cellKey(editing.row, editing.column)] ?? EMPTY}
          participantType={participantType}
          today={today}
          onClose={() => setEditing(null)}
        />
      )}
      {bulk && (
        <BulkDialog
          title={bulk.title}
          axis={bulk.axis}
          participantType={participantType}
          today={today}
          onClose={() => setBulk(null)}
        />
      )}
    </>
  );
}

function SectionRows({
  title,
  rows,
  columns,
  cells,
  onEdit,
  onBulk,
}: {
  title: string;
  rows: PricingRow[];
  columns: PricingColumn[];
  cells: Record<string, PricingCell>;
  onEdit: (row: PricingRow, column: PricingColumn) => void;
  onBulk: (row: PricingRow) => void;
}) {
  return (
    <>
      <TableRow className="bg-secondary/60 hover:bg-secondary/60">
        <TableCell
          colSpan={columns.length + 1}
          className="text-muted-foreground text-xs font-semibold tracking-wider uppercase"
        >
          {title}
        </TableCell>
      </TableRow>
      {rows.map((row) => (
        <TableRow key={row.id}>
          <TableCell className="bg-card sticky left-0 z-10 min-w-48">
            <div className="font-semibold">{row.name}</div>
            <div className="flex gap-1">
              <Button asChild variant="ghost" size="sm">
                <Link
                  href={`/admin/pricing/history/${row.scope}/${row.id}`}
                  aria-label={`Price history of ${row.name}`}
                >
                  <HistoryIcon /> History
                </Link>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Adjust all ${row.name} prices`}
                onClick={() => onBulk(row)}
              >
                <SlidersHorizontalIcon /> Adjust
              </Button>
            </div>
          </TableCell>
          {columns.map((col) => {
            const cell = cells[cellKey(row, col)] ?? EMPTY;
            return (
              <TableCell key={col.operatorId ?? "walk_in"} className="p-1 text-right">
                <button
                  type="button"
                  onClick={() => onEdit(row, col)}
                  aria-label={`Set ${row.name} price for ${col.name}`}
                  className={cn(
                    "hover:bg-accent flex min-h-14 w-full min-w-32 flex-col items-end justify-center rounded-md px-3 py-2",
                    !cell.current && !col.operatorId && "bg-warning-surface",
                  )}
                >
                  <CellContent cell={cell} column={col} />
                  {cell.next && (
                    <span className="text-accent-foreground text-xs">
                      → {formatRs(cell.next.retail)} from {formatDateShort(cell.next.from)}
                    </span>
                  )}
                </button>
              </TableCell>
            );
          })}
        </TableRow>
      ))}
    </>
  );
}
