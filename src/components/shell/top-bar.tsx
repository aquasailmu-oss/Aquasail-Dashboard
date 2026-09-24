import { signOut } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import type { SessionUser } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/roles";
import { businessDate, formatDateLong } from "@/lib/dates";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function TopBar({ user, companyName }: { user: SessionUser; companyName: string }) {
  return (
    <header className="bg-card border-border flex min-h-16 items-center justify-between gap-4 border-b px-4 py-3 md:px-6 print:hidden">
      <div className="min-w-0">
        <div className="truncate font-bold">{companyName}</div>
        <div className="text-muted-foreground text-sm">{formatDateLong(businessDate())}</div>
      </div>
      <div className="flex items-center gap-3">
        <div className="hidden text-right sm:block">
          <div className="font-semibold">{user.fullName}</div>
          <div className="text-muted-foreground text-sm">{ROLE_LABELS[user.role]}</div>
        </div>
        <div
          aria-hidden
          className="bg-accent text-accent-foreground flex size-10 items-center justify-center rounded-full font-bold"
        >
          {initials(user.fullName)}
        </div>
        <form action={signOut}>
          <Button type="submit" variant="outline" size="sm">
            Sign out
          </Button>
        </form>
      </div>
    </header>
  );
}
