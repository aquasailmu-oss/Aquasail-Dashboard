import type { QuoteLineInput } from "@/lib/pricing/types";

export type WizardPackage = {
  id: string;
  name: string;
  description: string | null;
  sale_unit: "participant" | "package";
  participants_per_unit: number;
  includes: { name: string; quantity: number }[];
  codes: string[];
};
export type WizardActivity = { id: string; name: string; code: string; participants_per_unit: number };
export type Participants = { adult: number; child: number; infant: number };
export type Purchase = {
  packageIds: string[];
  activityIds: string[];
  packageParticipants: Record<string, Participants>;
  activityParticipants: Record<string, Participants>;
  /** Unique booking guests; item quantities are activity entitlements/package units. */
  participants: Participants;
};

const TYPES = ["adult", "child", "infant"] as const;
const EMPTY_PARTICIPANTS: Participants = { adult: 0, child: 0, infant: 0 };

export function purchaseLines(purchase: Purchase): QuoteLineInput[] {
  const output: QuoteLineInput[] = [];
  for (const [target_type, ids, counts] of [
    ["package", purchase.packageIds, purchase.packageParticipants],
    ["activity", purchase.activityIds, purchase.activityParticipants],
  ] as const) {
    for (const target_id of ids) {
      for (const participant_type of TYPES) {
        const quantity = counts[target_id]?.[participant_type] ?? 0;
        if (quantity > 0) output.push({ target_type, target_id, participant_type, quantity });
      }
    }
  }
  return output;
}

/** Anything including the catamaran (directly or in a package) needs a boat. */
export function purchaseNeedsBoat(
  purchase: Purchase,
  packages: WizardPackage[],
  activities: WizardActivity[],
): boolean {
  return (
    purchase.packageIds.some((id) => packages.find((p) => p.id === id)?.codes.includes("CATAMARAN")) ||
    purchase.activityIds.some((id) => activities.find((a) => a.id === id)?.code === "CATAMARAN")
  );
}

export const partySize = (p: Participants) => p.adult + p.child + p.infant;

/** Unique guests required by the largest selected product group, without adding repeat activities. */
export function minimumPartySize(purchase: Purchase, packages: WizardPackage[]): number {
  const packagePeople = purchase.packageIds.map((id) => {
    const pkg = packages.find((item) => item.id === id);
    if (!pkg) return 0;
    const quantities = purchase.packageParticipants[id] ?? EMPTY_PARTICIPANTS;
    return partySize(quantities) * pkg.participants_per_unit;
  });
  const activityPeople = purchase.activityIds.map((id) =>
    partySize(purchase.activityParticipants[id] ?? EMPTY_PARTICIPANTS),
  );
  return Math.max(0, ...packagePeople, ...activityPeople);
}
