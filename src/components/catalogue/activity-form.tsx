"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveActivity } from "@/actions/catalogue";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useServerForm } from "@/lib/use-server-form";

type Activity = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_redeemable: boolean;
  default_duration_minutes: number | null;
  sort_order: number;
};

export function ActivityForm({ activity, nextSortOrder }: { activity?: Activity; nextSortOrder: number }) {
  const router = useRouter();
  const { result, pending, onSubmit } = useServerForm(saveActivity, {
    onSuccess: () => {
      toast.success(activity ? "Activity saved." : "Activity added.");
      router.push("/admin/activities");
    },
  });

  return (
    <form onSubmit={onSubmit} className="flex max-w-2xl flex-col gap-5" noValidate>
      {result && !result.ok && <Alert variant="destructive">{result.error}</Alert>}
      {activity && <input type="hidden" name="id" value={activity.id} />}
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="code">Code</Label>
          {activity ? (
            <>
              <Input id="code" value={activity.code} readOnly disabled className="font-mono" />
              <p className="text-muted-foreground text-sm">Codes never change; price lists and exports rely on them.</p>
            </>
          ) : (
            <>
              <Input
                id="code"
                name="code"
                className="font-mono uppercase"
                placeholder="PARASAIL"
                autoComplete="off"
                autoFocus
                required
              />
              <p className="text-warning text-sm font-semibold">
                The code cannot be changed once saved. Capital letters, digits and underscores.
              </p>
            </>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" defaultValue={activity?.name} autoFocus={!!activity} required />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="description">Description</Label>
        <Textarea id="description" name="description" defaultValue={activity?.description ?? ""} />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="default_duration_minutes">Usual duration (minutes)</Label>
          <Input
            id="default_duration_minutes"
            name="default_duration_minutes"
            type="number"
            inputMode="numeric"
            min={1}
            defaultValue={activity?.default_duration_minutes ?? ""}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="sort_order">Sort order</Label>
          <Input
            id="sort_order"
            name="sort_order"
            type="number"
            inputMode="numeric"
            min={0}
            defaultValue={activity?.sort_order ?? nextSortOrder}
            required
          />
          <p className="text-muted-foreground text-sm">Lower numbers are listed first.</p>
        </div>
      </div>
      <label className="flex min-h-11 items-center gap-3">
        <input
          type="checkbox"
          name="is_redeemable"
          defaultChecked={activity?.is_redeemable ?? true}
          className="size-5 accent-[var(--primary)]"
        />
        <span>
          <span className="font-semibold">Island staff tick it off</span>
          <span className="text-muted-foreground block text-sm">Redeemed on the ticket at the activity (from V2).</span>
        </span>
      </label>
      <div className="flex gap-3">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Saving…" : activity ? "Save activity" : "Add activity"}
        </Button>
        <Button type="button" size="lg" variant="outline" onClick={() => router.push("/admin/activities")}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
