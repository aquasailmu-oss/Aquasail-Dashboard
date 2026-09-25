import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ResetForm } from "@/components/auth/reset-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Choose a password · AquaSail Ops" };

/** Reached from a reset or invite email via /auth/callback, which signs the user in. */
export default async function ResetPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?notice=link-expired");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Choose a password</CardTitle>
        <CardDescription>For {user.email}</CardDescription>
      </CardHeader>
      <CardContent>
        <ResetForm />
      </CardContent>
    </Card>
  );
}
