import type { Metadata } from "next";
import { BookingWizard } from "@/components/booking/booking-wizard";
import { OperatorSelector } from "@/components/booking/operator-selector";
import { PageHeader } from "@/components/shell/page-header";
import { Alert } from "@/components/ui/alert";
import { requireRole } from "@/lib/auth";
import { businessDate } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "New booking · AquaSail Ops" };

export default async function NewBookingPage({
  searchParams,
}: {
  searchParams: Promise<{ operator?: string | string[] }>;
}) {
  await requireRole(["admin", "receptionist"]);
  const supabase = await createClient();
  const { operator: operatorParam } = await searchParams;
  const selectedOperatorId = Array.isArray(operatorParam) ? null : (operatorParam ?? null);
  const { data: operators, error: operatorError } = await supabase
    .from("tour_operators")
    .select("id, name, payer, logo_path")
    .eq("is_active", true)
    .order("name");
  if (operatorError) {
    return <Alert variant="destructive">Tour operators could not be loaded. Refresh the page to try again.</Alert>;
  }

  const operatorOptions = operators.map((operator) => ({
    id: operator.id,
    name: operator.name,
    payer: operator.payer as "client" | "operator",
    logoUrl: operator.logo_path
      ? supabase.storage.from("operator-logos").getPublicUrl(operator.logo_path).data.publicUrl
      : null,
  }));
  const selectedOperator = operatorOptions.find((operator) => operator.id === selectedOperatorId);

  if (!selectedOperator) {
    return (
      <>
        <PageHeader title="New booking" description="Choose the tour operator before entering the booking details." />
        {selectedOperatorId && (
          <Alert variant="destructive">That operator is unavailable. Choose an active operator to continue.</Alert>
        )}
        <OperatorSelector operators={operatorOptions} />
      </>
    );
  }

  const [packages, activities, boats, settings] = await Promise.all([
    supabase
      .from("packages")
      .select("id, name, description, package_activities(is_optional, sort_order, activities(name, code))")
      .eq("is_active", true)
      .order("sort_order")
      .order("name"),
    supabase.from("activities").select("id, name, code").eq("is_active", true).order("sort_order").order("name"),
    supabase.from("resources").select("id, name, capacity").eq("is_active", true).order("sort_order").order("name"),
    getSettings(),
  ]);
  if (packages.error || activities.error || boats.error) {
    return <Alert variant="destructive">The booking form could not be loaded. Refresh the page to try again.</Alert>;
  }

  return (
    <>
      <PageHeader title="New booking" />
      <BookingWizard
        packages={packages.data.map((p) => {
          const included = [...p.package_activities]
            .filter((pa) => !pa.is_optional)
            .sort((a, b) => a.sort_order - b.sort_order);
          return {
            id: p.id,
            name: p.name,
            description: p.description,
            includes: included.map((pa) => pa.activities?.name ?? ""),
            codes: included.map((pa) => pa.activities?.code ?? ""),
          };
        })}
        activities={activities.data}
        operators={operatorOptions}
        initialOperatorId={selectedOperator.id}
        boats={boats.data}
        defaultMeetingPoint={settings.default_meeting_point}
        today={businessDate()}
      />
    </>
  );
}
