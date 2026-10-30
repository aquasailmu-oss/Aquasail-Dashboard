import { describe, expect, it } from "vitest";
import { summarizeActivityParticipants } from "@/lib/activity-summary";

describe("summarizeActivityParticipants", () => {
  it("adds package and standalone pax for the same stable variant and calculates ride units", () => {
    const result = summarizeActivityParticipants([
      {
        activity_id: "double",
        quantity: 2,
        activities: { name: "Parasailing Double", sort_order: 10, participants_per_unit: 2 },
      },
      {
        activity_id: "double",
        quantity: 2,
        activities: { name: "Parasailing Double", sort_order: 10, participants_per_unit: 2 },
      },
    ]);

    expect(result).toEqual([{ activityId: "double", name: "Parasailing Double", quantity: 4, units: 2, order: 10 }]);
  });

  it("keeps variants with different stable IDs separate even if their display names match", () => {
    const result = summarizeActivityParticipants([
      {
        activity_id: "single",
        quantity: 1,
        activities: { name: "Parasailing", sort_order: 10, participants_per_unit: 1 },
      },
      {
        activity_id: "double",
        quantity: 2,
        activities: { name: "Parasailing", sort_order: 10, participants_per_unit: 2 },
      },
    ]);

    expect(result.map(({ activityId, quantity, units }) => ({ activityId, quantity, units }))).toEqual([
      { activityId: "single", quantity: 1, units: 1 },
      { activityId: "double", quantity: 2, units: 1 },
    ]);
  });
});
