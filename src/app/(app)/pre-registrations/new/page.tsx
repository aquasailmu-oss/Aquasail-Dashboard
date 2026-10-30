import type { Metadata } from "next";
import { PreRegistrationForm } from "@/components/booking/pre-registration-form";
import { PageHeader } from "@/components/shell/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { requireRole } from "@/lib/auth";
import { businessDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export const metadata: Metadata = { title: "Pre-register client · AquaSail Ops" };

export default async function NewPreRegistrationPage() {
  await requireRole(["admin", "receptionist"]);
  const supabase = await createClient();
  const { data: operators, error } = await supabase
    .from("tour_operators")
    .select("id, name, logo_path")
    .eq("is_active", true)
    .order("name");
  return (
    <>
      <PageHeader
        title="Pre-register a client"
        description="Save the client's details and visit date. Staff can search for them and complete the activities and booking when they arrive."
        actions={
          <Button asChild variant="outline">
            <Link href="/pre-registrations">Back to pre-registrations</Link>
          </Button>
        }
      />
      {error ? (
        <Alert variant="destructive">Tour operators could not be loaded. Refresh the page to try again.</Alert>
      ) : (
        <PreRegistrationForm
          operators={operators.map((operator) => ({
            id: operator.id,
            name: operator.name,
          }))}
          today={businessDate()}
        />
      )}
    </>
  );
}
