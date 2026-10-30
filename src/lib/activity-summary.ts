import { unitsForParticipants } from "@/lib/activity-units";

export type ActivityEntitlementInput = {
  activity_id: string;
  quantity: number;
  activities: { name: string; sort_order: number; participants_per_unit: number } | null;
};

export type ActivitySummaryLine = { activityId: string; name: string; quantity: number; units: number; order: number };

/** Combine package expansions and standalone entitlements by stable activity/variant ID. */
export function summarizeActivityParticipants(entries: ActivityEntitlementInput[]): ActivitySummaryLine[] {
  const grouped = new Map<string, Omit<ActivitySummaryLine, "units"> & { participantsPerUnit: number }>();
  for (const entry of entries) {
    if (!entry.activities) continue;
    const row = grouped.get(entry.activity_id) ?? {
      activityId: entry.activity_id,
      name: entry.activities.name,
      quantity: 0,
      order: entry.activities.sort_order,
      participantsPerUnit: entry.activities.participants_per_unit,
    };
    row.quantity += entry.quantity;
    grouped.set(entry.activity_id, row);
  }

  return [...grouped.values()]
    .sort((a, b) => a.order - b.order)
    .map(({ activityId, name, quantity, order, participantsPerUnit }) => ({
      activityId,
      name,
      quantity,
      units: unitsForParticipants(quantity, participantsPerUnit),
      order,
    }));
}
