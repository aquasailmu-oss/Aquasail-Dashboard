import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function Forbidden() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Not available for your role</CardTitle>
          <CardDescription>
            Your account does not have access to this page. If you need it, ask an admin to change your role.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href="/">Go to my home screen</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
