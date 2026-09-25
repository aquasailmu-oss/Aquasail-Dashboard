import type { Database } from "@/lib/database.types";

export type Role = Database["public"]["Enums"]["app_role"];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  accountant: "Accountant",
  receptionist: "Receptionist",
  activity_staff: "Activity staff",
};

/** What each role is for, shown where an admin picks one. */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  receptionist: "Creates bookings and takes payments.",
  accountant: "Reads bookings, prices and the audit log; exports.",
  activity_staff: "Island staff: scans tickets (V2). Sees no money or contact details.",
  admin: "Everything, including prices, users and settings.",
};
