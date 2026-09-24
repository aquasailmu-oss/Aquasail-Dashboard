"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "@/lib/navigation";
import { cn } from "@/lib/utils";

/** The most specific item wins, so /bookings/new highlights "New booking", not "Bookings". */
function activeHref(pathname: string, items: readonly NavItem[]): string | undefined {
  return items
    .filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}

export function AppSidebar({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname();
  const active = activeHref(pathname, items);
  const main = items.filter((i) => !i.section);
  const admin = items.filter((i) => i.section === "Admin");

  const link = (item: NavItem) => (
    <Link
      key={item.href}
      href={item.href}
      aria-current={item.href === active ? "page" : undefined}
      className={cn(
        "flex min-h-11 shrink-0 items-center gap-3 rounded-md px-3 text-[15px] font-medium whitespace-nowrap text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline-white md:w-full",
        item.href === active && "bg-white/15 text-white",
      )}
    >
      <span
        aria-hidden
        className={cn("bg-brand-cyan size-1.5 shrink-0 rounded-full", item.href !== active && "opacity-0")}
      />
      {item.label}
    </Link>
  );

  return (
    <nav
      aria-label="Main"
      className="bg-brand-blue flex shrink-0 items-center gap-2 overflow-x-auto px-4 py-3 text-white md:sticky md:top-0 md:h-screen md:w-58 md:flex-col md:items-stretch md:gap-0.5 md:overflow-y-auto md:px-3 md:py-5 print:hidden"
    >
      <Link href="/" className="mr-2 flex shrink-0 items-center px-2 focus-visible:outline-white md:mr-0 md:pb-6">
        <Image
          src="/aquasail-logo.svg"
          alt="AquaSail Ops home"
          width={120}
          height={40}
          className="h-auto w-20 brightness-0 invert md:w-30"
          priority
        />
      </Link>
      {main.map(link)}
      {admin.length > 0 && (
        <>
          <div className="hidden px-3 pt-6 pb-1 text-[11px] font-semibold tracking-[0.12em] text-white/60 uppercase md:block">
            Admin
          </div>
          {admin.map(link)}
        </>
      )}
    </nav>
  );
}
