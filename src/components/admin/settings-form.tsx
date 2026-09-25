"use client";

import { toast } from "sonner";
import { saveSettings } from "@/actions/settings";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useServerForm } from "@/lib/use-server-form";

type EditableSettings = {
  company_name: string;
  company_phone: string;
  company_email: string;
  default_meeting_point: string;
  ticket_footer_text: string;
  currency_label: string;
  max_discount_percent_receptionist: number;
};

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-muted-foreground text-sm">{hint}</p>}
    </div>
  );
}

export function SettingsForm({ settings }: { settings: EditableSettings }) {
  const { result, pending, onSubmit } = useServerForm(saveSettings, {
    onSuccess: () => toast.success("Settings saved."),
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      {result && !result.ok && <Alert variant="destructive">{result.error}</Alert>}
      <Card>
        <CardHeader>
          <CardTitle>Company</CardTitle>
          <CardDescription>Shown in the top bar and printed on tickets.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 md:grid-cols-2">
          <div className="md:col-span-2">
            <Field id="company_name" label="Company name">
              <Input id="company_name" name="company_name" defaultValue={settings.company_name} required />
            </Field>
          </div>
          <Field id="company_phone" label="Phone">
            <Input id="company_phone" name="company_phone" type="tel" defaultValue={settings.company_phone} />
          </Field>
          <Field id="company_email" label="Email">
            <Input id="company_email" name="company_email" type="email" defaultValue={settings.company_email} />
          </Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Bookings and tickets</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5">
          <Field id="default_meeting_point" label="Default meeting point" hint="Pre-filled on every new booking.">
            <Input
              id="default_meeting_point"
              name="default_meeting_point"
              defaultValue={settings.default_meeting_point}
            />
          </Field>
          <Field id="ticket_footer_text" label="Ticket footer" hint="Printed at the bottom of every ticket.">
            <Textarea id="ticket_footer_text" name="ticket_footer_text" defaultValue={settings.ticket_footer_text} />
          </Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Money</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 md:grid-cols-2">
          <Field id="currency_label" label="Currency label" hint="Shown before amounts, e.g. Rs.">
            <Input id="currency_label" name="currency_label" defaultValue={settings.currency_label} required />
          </Field>
          <Field
            id="max_discount_percent_receptionist"
            label="Largest discount a receptionist may give (%)"
            hint="Anything above needs an admin. Checked on the server for every booking."
          >
            <Input
              id="max_discount_percent_receptionist"
              name="max_discount_percent_receptionist"
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              step={1}
              defaultValue={settings.max_discount_percent_receptionist}
              required
            />
          </Field>
        </CardContent>
      </Card>
      <div>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </form>
  );
}
