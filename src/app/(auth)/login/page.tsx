import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { safeNextPath } from "@/lib/navigation";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Sign in · AquaSail Ops" };

const NOTICES: Record<string, string> = {
  "link-expired": "That link has expired or was already used. Request a new one below.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; notice?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/");

  const { next, notice } = await searchParams;
  const noticeText = notice ? NOTICES[notice] : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Sign in</CardTitle>
        <CardDescription>AquaSail Ops. Accounts are created by an admin.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {noticeText && <Alert variant="warning">{noticeText}</Alert>}
        <LoginForm next={safeNextPath(next) ?? undefined} />
      </CardContent>
    </Card>
  );
}
