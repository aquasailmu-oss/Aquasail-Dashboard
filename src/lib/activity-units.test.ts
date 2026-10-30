import { describe, expect, it } from "vitest";
import { unitsForParticipants } from "@/lib/activity-units";

describe("unitsForParticipants", () => {
  it("converts double-ride participant quantities into rides", () => {
    expect(unitsForParticipants(4, 2)).toBe(2);
  });

  it("rounds up when a group does not fill the last unit", () => {
    expect(unitsForParticipants(3, 2)).toBe(2);
  });

  it("keeps single-participant activities one-for-one", () => {
    expect(unitsForParticipants(4, 1)).toBe(4);
  });

  it("returns zero when no participants receive the activity", () => {
    expect(unitsForParticipants(0, 2)).toBe(0);
  });
});
