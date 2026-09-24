"use client";

import { toast } from "sonner";
import { uploadLogo } from "@/actions/settings";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useServerForm } from "@/lib/use-server-form";

export function LogoForm({ logoPath }: { logoPath: string }) {
  const { result, pending, onSubmit } = useServerForm(uploadLogo, {
    onSuccess: () => toast.success("Logo uploaded."),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Logo</CardTitle>
        <CardDescription>Printed on tickets. PNG, JPEG or WebP, under 1 MB.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {logoPath ? (
          // eslint-disable-next-line @next/next/no-img-element -- served by our own route, already sized
          <img
            src={`/branding/logo?v=${encodeURIComponent(logoPath)}`}
            alt="Current logo"
            className="max-h-24 w-fit rounded-md border p-2"
          />
        ) : (
          <p className="text-muted-foreground">No logo uploaded yet. Tickets print the company name instead.</p>
        )}
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          {result && !result.ok && <Alert variant="destructive">{result.error}</Alert>}
          <div className="flex flex-col gap-2">
            <Label htmlFor="logo">New logo</Label>
            <Input id="logo" name="logo" type="file" accept="image/png,image/jpeg,image/webp" required />
          </div>
          <div>
            <Button type="submit" variant="outline" disabled={pending}>
              {pending ? "Uploading…" : "Upload logo"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
