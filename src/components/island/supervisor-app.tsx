"use client";

import { useState } from "react";
import Link from "next/link";
import { ReviewQueue } from "./review-queue";
import { DeviceManagement } from "./device-management";
import { ShiftHandover } from "./shift-handover";

type Tab = "review" | "devices" | "shift";

export function SupervisorApp({
  staffName,
  deviceLabel,
  locationName,
}: {
  staffName: string;
  deviceLabel: string;
  locationName: string | null;
}) {
  const [tab, setTab] = useState<Tab>("review");

  return (
    <div className="flex min-h-dvh flex-col bg-white text-lg text-[#0a0a0a]">
      <header className="bg-[#2c3792] px-4 py-2 text-white">
        <div className="flex items-center justify-between">
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="truncate font-bold">{staffName}</span>
            <span className="truncate text-base">
              {deviceLabel}
              {locationName && ` · ${locationName}`}
            </span>
            <span className="text-sm text-white/80">Supervisor</span>
          </div>
          <Link
            href="/scan"
            className="min-h-14 rounded-lg px-3 text-base font-bold underline flex items-center"
          >
            Back to scanner
          </Link>
        </div>
      </header>

      <nav className="flex border-b border-[#e5e7eb]" role="tablist">
        <TabButton active={tab === "review"} onClick={() => setTab("review")}>
          Review queue
        </TabButton>
        <TabButton active={tab === "devices"} onClick={() => setTab("devices")}>
          Devices
        </TabButton>
        <TabButton active={tab === "shift"} onClick={() => setTab("shift")}>
          Shift
        </TabButton>
      </nav>

      <div className="flex-1 overflow-y-auto">
        {tab === "review" && <ReviewQueue />}
        {tab === "devices" && <DeviceManagement />}
        {tab === "shift" && <ShiftHandover />}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`min-h-11 flex-1 border-b-2 px-2 py-3 text-base font-bold ${
        active ? "border-[#2c3792] text-[#2c3792]" : "border-transparent text-[#6b7280]"
      }`}
    >
      {children}
    </button>
  );
}
