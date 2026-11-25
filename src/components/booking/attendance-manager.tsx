"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordAttendance } from "@/actions/attendance";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Counts = { adult: number; child: number; infant: number };
type SavedAttendance = {
  adults_present_count: number;
  children_present_count: number;
  infants_present_count: number;
};

const LABELS: { key: keyof Counts; label: string }[] = [
  { key: "adult", label: "Adults" },
  { key: "child", label: "Children" },
  { key: "infant", label: "Infants" },
];

export function AttendanceManager({
  bookingId,
  expected,
  attendance,
  canManage,
}: {
  bookingId: string;
  expected: Counts;
  attendance: SavedAttendance | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const [present, setPresent] = useState<Counts>({
    adult: attendance?.adults_present_count ?? expected.adult,
    child: attendance?.children_present_count ?? expected.child,
    infant: attendance?.infants_present_count ?? expected.infant,
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, startTransition] = useTransition();

  const absent: Counts = {
    adult: expected.adult - present.adult,
    child: expected.child - present.child,
    infant: expected.infant - present.infant,
  };
  const totalExpected = expected.adult + expected.child + expected.infant;
  const totalPresent = present.adult + present.child + present.infant;
  const totalAbsent = totalExpected - totalPresent;
  const validAttendance = LABELS.every(
    ({ key }) => Number.isInteger(present[key]) && present[key] >= 0 && present[key] <= expected[key],
  );
  function updatePresent(type: keyof Counts, value: string) {
    const next = value === "" ? 0 : Number(value);
    setPresent((current) => ({ ...current, [type]: Number.isFinite(next) ? next : 0 }));
    setSaved(false);
    setError(null);
  }

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await recordAttendance({
        booking_id: bookingId,
        adults_present: present.adult,
        children_present: present.child,
        infants_present: present.infant,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <Card className="mt-8">
      <CardHeader>
        <CardTitle>Attendance</CardTitle>
        <p className="text-muted-foreground text-sm">
          Record who arrived separately from the original booking. The waiver requirement will use the attendees once
          saved.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!attendance && <Alert>Attendance has not been recorded. Waivers currently use the booked guest count.</Alert>}
        {error && <Alert variant="destructive">{error}</Alert>}
        {saved && <Alert variant="success">Attendance saved. The waiver count has been updated.</Alert>}

        <div className="grid gap-3 sm:grid-cols-3">
          {LABELS.map(({ key, label }) => (
            <div key={key} className="rounded-md border p-3">
              <Label htmlFor={`attendance-${key}`} className="font-semibold">
                {label}
              </Label>
              <p className="text-muted-foreground mt-1 text-sm">Booked: {expected[key]}</p>
              <div className="mt-2 flex items-center gap-2">
                <Input
                  id={`attendance-${key}`}
                  type="number"
                  min={0}
                  max={expected[key]}
                  step={1}
                  value={present[key]}
                  disabled={!canManage || busy}
                  onChange={(event) => updatePresent(key, event.target.value)}
                  aria-label={`${label} present`}
                />
                <span className="text-muted-foreground shrink-0 text-sm">present</span>
              </div>
              <p className="mt-2 text-sm">Absent: {absent[key]}</p>
            </div>
          ))}
        </div>

        <div className="bg-muted flex flex-wrap items-center justify-between gap-2 rounded-md p-3 text-sm">
          <span>
            Present: {totalPresent} / {totalExpected}
          </span>
          <span>Absent: {totalAbsent}</span>
        </div>

        {canManage && (
          <div className="flex justify-end">
            <Button type="button" onClick={save} disabled={busy || !validAttendance}>
              {busy ? "Saving attendance…" : attendance ? "Update attendance" : "Save attendance"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
