import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { businessDate, formatDateLong } from "@/lib/dates";

// Placeholder until WP-08 adds login and the role-aware shell.
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-4">
      <Card className="w-full">
        <CardHeader>
          <Badge variant="info" className="w-fit">
            V0 · Foundation
          </Badge>
          <CardTitle className="text-2xl">AquaSail Ops</CardTitle>
          <CardDescription>{formatDateLong(businessDate())}</CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground">
          The project is set up. Sign-in and the reception screens arrive in the next work packages.
        </CardContent>
      </Card>
    </main>
  );
}
