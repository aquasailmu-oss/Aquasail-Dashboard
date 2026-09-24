"use client";

import { SearchIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Input } from "@/components/ui/input";

/** Search box that keeps the query in the URL (bookmarkable), searched on the server. */
export function ClientSearch({ initial }: { initial: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState(initial);
  const [pending, startTransition] = useTransition();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(() => {
      const q = value.trim();
      startTransition(() => router.replace(q ? `${pathname}?q=${encodeURIComponent(q)}` : pathname));
    }, 250);
    return () => clearTimeout(timer);
  }, [value, pathname, router]);

  return (
    <div className="relative max-w-xl">
      <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2" />
      <Input
        type="search"
        aria-label="Search clients by name, phone or email"
        placeholder="Name, phone or email"
        className="pl-10"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-busy={pending}
      />
    </div>
  );
}
