import type { Role } from "@/lib/roles";

export type NavItem = { href: string; label: string; roles: readonly Role[]; section?: "Admin" };

const OFFICE: readonly Role[] = ["admin", "accountant", "receptionist"];

/** The sidebar, per role (build plan WP-08). Pages enforce the same roles with requireRole(). */
const NAV_ITEMS: readonly NavItem[] = [
  { href: "/today", label: "Today", roles: OFFICE },
  { href: "/bookings/new", label: "New booking", roles: ["admin", "receptionist"] },
  { href: "/bookings", label: "Bookings", roles: OFFICE },
  { href: "/clients", label: "Clients", roles: OFFICE },
  { href: "/register", label: "Daily register", roles: OFFICE },
  { href: "/reports", label: "Reports", roles: ["admin", "accountant"] },
  { href: "/export", label: "Export", roles: ["admin", "accountant"] },
  { href: "/scan", label: "Scan", roles: ["activity_staff"] },
  { href: "/admin/activities", label: "Activities", roles: ["admin"], section: "Admin" },
  { href: "/admin/packages", label: "Packages", roles: ["admin"], section: "Admin" },
  { href: "/admin/operators", label: "Operators", roles: ["admin"], section: "Admin" },
  { href: "/admin/pricing", label: "Pricing", roles: ["admin"], section: "Admin" },
  { href: "/admin/users", label: "Users", roles: ["admin"], section: "Admin" },
  { href: "/admin/audit", label: "Audit log", roles: ["admin"], section: "Admin" },
  { href: "/admin/settings", label: "Settings", roles: ["admin"], section: "Admin" },
];

export function navFor(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

/** Where a role lands after signing in. */
export function landingPath(role: Role): string {
  return role === "activity_staff" ? "/scan" : "/today";
}

/** Only same-site paths are honoured as a post-login destination. */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  return next;
}
