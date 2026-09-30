import { DeviceSetup } from "@/components/island/device-setup";
import { IslandApp } from "@/components/island/island-app";
import { requireRole } from "@/lib/auth";
import { currentDevice } from "@/lib/device";
import { createClient } from "@/lib/supabase/server";

/** The island app (V2 WP-27). Island staff land here after signing in. */
export default async function ScanPage() {
  const user = await requireRole(["activity_staff", "activity_supervisor", "admin"]);
  const device = await currentDevice();

  if (device.status === "ok") {
    return (
      <IslandApp
        staffName={user.fullName}
        deviceLabel={device.device.label}
        locationName={device.device.locationName}
        isSupervisor={user.role === "activity_supervisor" || user.role === "admin"}
      />
    );
  }

  const canRegister = user.role !== "activity_staff";
  const supabase = await createClient();
  const { data: locations } = canRegister
    ? await supabase.from("locations").select("id, name").eq("is_active", true).order("name")
    : { data: [] };
  const reason =
    device.status === "refused"
      ? device.reason
      : canRegister
        ? "This device is not registered yet."
        : "This device is not registered. Ask a supervisor to sign in on it and register it.";
  return <DeviceSetup staffName={user.fullName} reason={reason} locations={locations ?? []} />;
}
