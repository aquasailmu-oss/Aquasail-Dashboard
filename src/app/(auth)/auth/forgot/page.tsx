import type { Metadata } from "next";
import Link from "next/link";
import { ForgotForm } from "@/components/auth/forgot-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Reset password · AquaSail Ops" };

export default function ForgotPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Reset your password</CardTitle>
        <CardDescription>We will email you a link to choose a new one.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <ForgotForm />
        <Link
          href="/login"
          className="text-accent-foreground inline-flex min-h-11 items-center self-start font-semibold underline-offset-4 hover:underline"
        >
          Back to sign in
        </Link>
      </CardContent>
    </Card>
  );
}
