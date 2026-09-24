import type { Metadata } from "next";
import { signOut } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Account deactivated · AquaSail Ops" };

export default function DeactivatedPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Your account is deactivated</CardTitle>
        <CardDescription>
          You are signed in, but this account can no longer use AquaSail Ops. Ask an admin to reactivate it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={signOut}>
          <Button type="submit" variant="outline" className="w-full">
            Sign out
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
