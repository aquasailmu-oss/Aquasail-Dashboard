import { requireRole } from "@/lib/auth";
import { currentDevice } from "@/lib/device";
import { redirect } from "next/navigation";
import { SupervisorApp } from "@/components/island/supervisor-app";

export default async function SupervisorPage() {
  const user = await requireRole(["activity_supervisor", "admin"]);
  const device = await currentDevice();

  if (device.status !== "ok") {
    redirect("/scan");
  }

  return (
    <SupervisorApp
      staffName={user.fullName}
      deviceLabel={device.device.label}
      locationName={device.device.locationName}
    />
  );
}
