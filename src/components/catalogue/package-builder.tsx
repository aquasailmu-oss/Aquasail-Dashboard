"use client";

import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { previewPackage, savePackage, type PackagePreview } from "@/actions/catalogue";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cents, formatRs } from "@/lib/money";
import { openAfterSave } from "@/lib/navigate";
import { cn } from "@/lib/utils";

type ActivityOption = { id: string; code: string; name: string; is_active: boolean };
type Line = { activity_id: string; quantity_per_participant: number; is_optional: boolean };
type ExistingPackage = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  pricing_mode: "bundle" | "components";
  is_active: boolean;
  lines: Line[];
};

const MODES = [
  {
    value: "bundle",
    title: "One package price",
    body: "The package has its own price per participant type, set in Pricing. Use for deals like Island Explorer.",
  },
  {
    value: "components",
    title: "Sum of its activities",
    body: "The price is the activities' own prices added up. Nothing extra to maintain in Pricing.",
  },
] as const;

export function PackageBuilder({ pkg, activities }: { pkg?: ExistingPackage; activities: ActivityOption[] }) {
  const router = useRouter();
  const [code, setCode] = useState(pkg?.code ?? "");
  const [name, setName] = useState(pkg?.name ?? "");
  const [description, setDescription] = useState(pkg?.description ?? "");
  const [mode, setMode] = useState<"bundle" | "components">(pkg?.pricing_mode ?? "bundle");
  const [isActive, setIsActive] = useState(pkg?.is_active ?? true);
  const [lines, setLines] = useState<Line[]>(pkg?.lines ?? []);
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<PackagePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const previewCall = useRef(0);

  const byId = useMemo(() => new Map(activities.map((a) => [a.id, a])), [activities]);
  const chosen = new Set(lines.map((l) => l.activity_id));
  const available = activities.filter(
    (a) =>
      a.is_active &&
      !chosen.has(a.id) &&
      (!search.trim() || `${a.code} ${a.name}`.toLowerCase().includes(search.trim().toLowerCase())),
  );

  useEffect(() => {
    if (lines.length === 0) {
      setPreview(null);
      return;
    }
    const call = ++previewCall.current;
    const timer = setTimeout(async () => {
      const result = await previewPackage({ id: pkg?.id, pricing_mode: mode, activities: lines });
      if (call === previewCall.current && result.ok) setPreview(result.data);
    }, 250);
    return () => clearTimeout(timer);
  }, [lines, mode, pkg?.id]);

  const update = (i: number, change: Partial<Line>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...change } : l)));
  const move = (i: number, by: -1 | 1) =>
    setLines((ls) => {
      const next = [...ls];
      [next[i], next[i + by]] = [next[i + by], next[i]];
      return next;
    });

  function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startSaving(async () => {
      const result = await savePackage({
        id: pkg?.id,
        code: pkg ? undefined : code,
        name,
        description,
        pricing_mode: mode,
        is_active: isActive,
        activities: lines,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Saved without a price for today: stay (an edit) or open the new package, whose preview says so.
      if (result.data.warning && pkg) {
        toast.warning(result.data.warning, {
          duration: 10000,
          action: { label: "Open Pricing", onClick: () => router.push("/admin/pricing") },
        });
        return;
      }
      openAfterSave(pkg ? "/admin/packages" : `/admin/packages/${result.data.id}`);
    });
  }

  return (
    <form onSubmit={save} className="grid gap-6 xl:grid-cols-[1fr_22rem]" noValidate>
      <div className="flex min-w-0 flex-col gap-6">
        {error && <Alert variant="destructive">{error}</Alert>}
        <Card>
          <CardContent className="grid gap-5 pt-6 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="code">Code</Label>
              {pkg ? (
                <Input id="code" value={pkg.code} readOnly disabled className="font-mono" />
              ) : (
                <>
                  <Input
                    id="code"
                    className="font-mono uppercase"
                    placeholder="SUNSET"
                    autoComplete="off"
                    autoFocus
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                  <p className="text-warning text-sm font-semibold">The code cannot be changed once saved.</p>
                </>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What reception reads out to the customer."
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>What’s included</CardTitle>
            <CardDescription>
              Per participant. Optional activities are not included in the price or the ticket unless chosen.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {lines.length === 0 ? (
              <p className="text-muted-foreground">No activities yet. Add them from the list below.</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {lines.map((line, i) => {
                  const a = byId.get(line.activity_id);
                  return (
                    <li key={line.activity_id} className="flex flex-wrap items-center gap-3 rounded-md border p-2">
                      <span className="min-w-40 flex-1 font-semibold">
                        {a?.name ?? "Unknown activity"}
                        {a && !a.is_active && <span className="text-warning ml-2 text-sm">deactivated</span>}
                      </span>
                      <label className="flex items-center gap-2 text-sm">
                        Qty
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={20}
                          className="w-20"
                          aria-label={`Quantity of ${a?.name} per participant`}
                          value={line.quantity_per_participant}
                          onChange={(e) =>
                            update(i, {
                              quantity_per_participant: Math.max(1, Number.parseInt(e.target.value, 10) || 1),
                            })
                          }
                        />
                      </label>
                      <label className="flex min-h-11 items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="accent-primary size-5"
                          checked={line.is_optional}
                          onChange={(e) => update(i, { is_optional: e.target.checked })}
                        />
                        Optional
                      </label>
                      <div className="flex">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={i === 0}
                          aria-label={`Move ${a?.name} up`}
                          onClick={() => move(i, -1)}
                        >
                          <ArrowUpIcon />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={i === lines.length - 1}
                          aria-label={`Move ${a?.name} down`}
                          onClick={() => move(i, 1)}
                        >
                          <ArrowDownIcon />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${a?.name}`}
                          onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                        >
                          <XIcon />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
            <div className="border-t pt-4">
              <Label htmlFor="activity-search">Add an activity</Label>
              <Input
                id="activity-search"
                type="search"
                className="mt-2"
                placeholder="Search activities"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                {available.map((a) => (
                  <Button
                    key={a.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setLines((ls) => [...ls, { activity_id: a.id, quantity_per_participant: 1, is_optional: false }]);
                      setSearch("");
                    }}
                  >
                    <PlusIcon />
                    {a.name}
                  </Button>
                ))}
                {available.length === 0 && <p className="text-muted-foreground text-sm">No more activities match.</p>}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>How it is priced</CardTitle>
          </CardHeader>
          <CardContent>
            <fieldset className="flex flex-col gap-3">
              <legend className="sr-only">Pricing mode</legend>
              {MODES.map((m) => (
                <label
                  key={m.value}
                  className={cn(
                    "flex cursor-pointer gap-3 rounded-md border-2 p-3",
                    mode === m.value ? "border-primary bg-accent" : "border-border",
                  )}
                >
                  <input
                    type="radio"
                    name="pricing_mode"
                    value={m.value}
                    checked={mode === m.value}
                    onChange={() => setMode(m.value)}
                    className="accent-primary mt-1 size-5 shrink-0"
                  />
                  <span>
                    <span className="block font-semibold">{m.title}</span>
                    <span className="text-muted-foreground text-sm">{m.body}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          </CardContent>
        </Card>

        <Card aria-live="polite">
          <CardHeader>
            <CardTitle>Walk-in adult today</CardTitle>
            <CardDescription>A preview of the current price list, not a quote.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {!preview ? (
              <p className="text-muted-foreground">
                {lines.length === 0 ? "Add activities to see the price." : "Checking prices…"}
              </p>
            ) : (
              <>
                {mode === "components" && (
                  <ul className="flex flex-col gap-1 text-sm">
                    {preview.lines.map((l) => (
                      <li
                        key={l.activity_id}
                        className={cn("flex justify-between gap-2", l.is_optional && "text-muted-foreground")}
                      >
                        <span>
                          {l.quantity > 1 && `${l.quantity} × `}
                          {byId.get(l.activity_id)?.name}
                          {l.is_optional && " (optional)"}
                        </span>
                        <span className="tabular-nums">
                          {l.unit_cents === null ? (
                            <span className="text-warning font-semibold">not set</span>
                          ) : (
                            formatRs(cents(l.unit_cents * l.quantity))
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {preview.total_cents !== null ? (
                  <div className="font-display text-3xl font-semibold tabular-nums">
                    {formatRs(preview.total_cents)}
                  </div>
                ) : (
                  <Alert variant="warning">
                    <div className="flex items-start gap-2">
                      <TriangleAlertIcon className="mt-0.5 size-5 shrink-0" />
                      <div>
                        {mode === "bundle"
                          ? pkg
                            ? "No walk-in adult price is set for today."
                            : "Bundle prices are set in Pricing after the package is saved."
                          : "Some activities have no walk-in adult price for today."}{" "}
                        <Link href="/admin/pricing" className="font-semibold underline">
                          Open Pricing
                        </Link>
                      </div>
                    </div>
                  </Alert>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            <label className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                className="accent-primary size-5"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              <span>
                <span className="font-semibold">On sale</span>
                <span className="text-muted-foreground block text-sm">Reception can book it.</span>
              </span>
            </label>
            <Button type="submit" size="lg" disabled={saving}>
              {saving ? "Saving…" : pkg ? "Save package" : "Create package"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </form>
  );
}
