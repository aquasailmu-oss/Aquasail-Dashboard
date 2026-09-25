"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Keeps a screen current: refresh on window focus and every minute, so two desks never work from stale figures. */
export function TodayRefresher({ everyMs = 60_000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = setInterval(refresh, everyMs);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [router, everyMs]);
  return null;
}
