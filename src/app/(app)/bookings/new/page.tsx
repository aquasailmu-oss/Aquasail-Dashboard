import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BookingWizard } from "@/components/booking/booking-wizard";
import { OperatorSelector } from "@/components/booking/operator-selector";
import { PageHeader } from "@/components/shell/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { ClientMatch } from "@/actions/clients";
import { requireRole } from "@/lib/auth";
import { businessDate } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "New booking · AquaSail Ops" };

export default async function NewBookingPage({
  searchParams,
}: {
  searchParams: Promise<{ operator?: string | string[]; pre_registration?: string | string[] }>;
}) {
  await requireRole(["admin", "receptionist"]);
  const supabase = await createClient();
  const params = await searchParams;
  const operatorParam = params.operator;
  const registrationParam = params.pre_registration;
  const preRegistrationId = typeof registrationParam === "string" ? registrationParam : null;
  let preRegistration: {
    id: string;
    idempotencyKey: string;
    serviceDate: string;
    operatorId: string;
    notes: string | null;
    client: ClientMatch;
  } | null = null;
  if (preRegistrationId) {
    const { data: registration, error } = await supabase
      .from("booking_pre_registrations")
      .select(
        "id, idempotency_key, service_date, operator_id, status, notes, booking_id, clients(id, first_name, last_name, phone_e164, email, country)",
      )
      .eq("id", preRegistrationId)
      .maybeSingle();
    if (error || !registration?.clients) {
      return (
        <>
          <PageHeader title="Complete pre-registration" />
          <Alert variant="destructive">
            This pre-registration could not be loaded. Apply the latest database migration and try again.
          </Alert>
          <Button asChild className="mt-4">
            <Link href="/pre-registrations">Back to pre-registrations</Link>
          </Button>
        </>
      );
    }
    if (registration.status === "completed" && registration.booking_id) {
      redirect(`/bookings/${registration.booking_id}/confirmation`);
    }
    if (registration.status !== "open") {
      return (
        <>
          <PageHeader title="Complete pre-registration" />
          <Alert>This pre-registration has already been completed or cancelled.</Alert>
          <Button asChild className="mt-4">
            <Link href="/pre-registrations">Back to pre-registrations</Link>
          </Button>
        </>
      );
    }
    const { data: existingBooking, error: lookupError } = await supabase
      .from("bookings")
      .select("id")
      .eq("idempotency_key", registration.idempotency_key)
      .maybeSingle();
    if (lookupError) {
      return (
        <>
          <PageHeader title="Complete pre-registration" />
          <Alert variant="destructive">
            The existing booking could not be checked. Refresh this page to retry safely.
          </Alert>
          <Button asChild className="mt-4">
            <Link href="/pre-registrations">Back to pre-registrations</Link>
          </Button>
        </>
      );
    }
    if (existingBooking) {
      const { error: recoveryError } = await supabase.rpc("complete_booking_pre_registration", {
        p_registration_id: registration.id,
        p_booking_id: existingBooking.id,
      });
      if (!recoveryError) redirect(`/bookings/${existingBooking.id}/confirmation`);
      return (
        <>
          <PageHeader title="Complete pre-registration" />
          <Alert variant="destructive">
            The booking is saved, but the pre-registration link could not be finished. Refresh this page to retry.
          </Alert>
          <Button asChild className="mt-4">
            <Link href="/pre-registrations">Back to pre-registrations</Link>
          </Button>
        </>
      );
    }
    preRegistration = {
      id: registration.id,
      idempotencyKey: registration.idempotency_key,
      serviceDate: registration.service_date,
      operatorId: registration.operator_id,
      notes: registration.notes,
      client: {
        id: registration.clients.id,
        first_name: registration.clients.first_name,
        last_name: registration.clients.last_name,
        phone_e164: registration.clients.phone_e164 ?? "",
        email: registration.clients.email ?? "",
        country: registration.clients.country ?? "",
        booking_count: 0,
        confidence: "high",
        last_visit: "",
        match_reason: "Pre-registered",
      },
    };
  }
  const selectedOperatorId =
    preRegistration?.operatorId ?? (Array.isArray(operatorParam) ? null : (operatorParam ?? null));
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

  if (preRegistrationId && !selectedOperator) {
    return (
      <>
        <PageHeader title="Complete pre-registration" />
        <Alert variant="destructive">
          The saved tour operator is no longer active. Ask an admin to update the pre-registration.
        </Alert>
        <Button asChild className="mt-4">
          <Link href="/pre-registrations">Back to pre-registrations</Link>
        </Button>
      </>
    );
  }

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
    supabase
      .from("activities")
      .select("id, name, code, participants_per_unit")
      .eq("is_active", true)
      .order("sort_order")
      .order("name"),
    supabase.from("resources").select("id, name, capacity").eq("is_active", true).order("sort_order").order("name"),
    getSettings(),
  ]);
  if (packages.error || activities.error || boats.error) {
    return <Alert variant="destructive">The booking form could not be loaded. Refresh the page to try again.</Alert>;
  }

  return (
    <>
      <PageHeader title={preRegistration ? "Complete pre-registration" : "New booking"} />
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
        preRegistration={
          preRegistration
            ? {
                id: preRegistration.id,
                idempotencyKey: preRegistration.idempotencyKey,
                serviceDate: preRegistration.serviceDate,
                notes: preRegistration.notes,
                client: preRegistration.client,
              }
            : undefined
        }
      />
    </>
  );
}
