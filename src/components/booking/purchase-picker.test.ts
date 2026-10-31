import { describe, expect, it } from "vitest";
import {
  minimumPartySize,
  purchaseLines,
  type Purchase,
  type WizardPackage,
} from "@/components/booking/purchase-utils";

const packages: WizardPackage[] = [
  {
    id: "double",
    name: "Combo Double",
    description: null,
    sale_unit: "package",
    participants_per_unit: 2,
    includes: [{ name: "Parasailing Single", quantity: 2 }],
    codes: ["PARASAIL_SINGLE"],
  },
];

const purchase: Purchase = {
  packageIds: ["double"],
  activityIds: ["parasailing-single"],
  packageParticipants: { double: { adult: 1, child: 0, infant: 0 } },
  activityParticipants: { "parasailing-single": { adult: 1, child: 0, infant: 0 } },
  participants: { adult: 2, child: 0, infant: 0 },
};

describe("package units and booking guests", () => {
  it("keeps one double package unit as quantity one while requiring two guests", () => {
    expect(purchaseLines(purchase)).toEqual([
      { target_type: "package", target_id: "double", participant_type: "adult", quantity: 1 },
      {
        target_type: "activity",
        target_id: "parasailing-single",
        participant_type: "adult",
        quantity: 1,
      },
    ]);
    expect(minimumPartySize(purchase, packages)).toBe(2);
  });

  it("does not add repeated standalone activity participants to the unique guest count", () => {
    expect(
      minimumPartySize(
        {
          ...purchase,
          activityParticipants: { "parasailing-single": { adult: 3, child: 0, infant: 0 } },
        },
        packages,
      ),
    ).toBe(3);
  });
});
