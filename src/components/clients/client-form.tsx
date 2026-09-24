"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { createClientRecord, findSimilarClients, updateClientRecord, type ClientMatch } from "@/actions/clients";
import { ClientMatchBanner } from "@/components/clients/client-match-banner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatPhone } from "@/lib/phone";
import { useServerForm } from "@/lib/use-server-form";

type ExistingClient = {
  id: string;
  first_name: string;
  last_name: string;
  phone_e164: string | null;
  email: string | null;
  country: string | null;
};

/** Create (no `client`) or edit a client, checking for duplicates as details are typed. */
export function ClientForm({ client }: { client?: ExistingClient }) {
  const router = useRouter();
  const [values, setValues] = useState({
    first_name: client?.first_name ?? "",
    last_name: client?.last_name ?? "",
    phone: formatPhone(client?.phone_e164),
    email: client?.email ?? "",
  });
  const [matches, setMatches] = useState<ClientMatch[]>([]);
  const lookup = useRef(0);

  const { result, pending, onSubmit } = useServerForm(client ? updateClientRecord : createClientRecord, {
    onSuccess: ({ id }) => {
      toast.success(client ? "Client updated." : "Client added.");
      router.push(`/clients/${id}`);
    },
  });

  useEffect(() => {
    const unchanged =
      client &&
      values.first_name === client.first_name &&
      values.last_name === client.last_name &&
      values.phone === formatPhone(client.phone_e164) &&
      values.email === (client.email ?? "");
    if (unchanged || (!values.phone && !values.email && values.first_name.length + values.last_name.length < 4)) {
      setMatches([]);
      return;
    }
    const call = ++lookup.current;
    const timer = setTimeout(async () => {
      const found = await findSimilarClients({ ...values, exclude_id: client?.id });
      if (call === lookup.current) setMatches(found.ok ? found.data : []);
    }, 300);
    return () => clearTimeout(timer);
  }, [values, client]);

  const bind = (name: keyof typeof values) => ({
    name,
    value: values[name],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [name]: e.target.value })),
  });

  return (
    <form onSubmit={onSubmit} className="flex max-w-2xl flex-col gap-5" noValidate>
      {result && !result.ok && <Alert variant="destructive">{result.error}</Alert>}
      {client && <input type="hidden" name="id" value={client.id} />}
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="first_name">First name</Label>
          <Input id="first_name" autoComplete="off" autoFocus required {...bind("first_name")} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="last_name">Last name</Label>
          <Input id="last_name" autoComplete="off" {...bind("last_name")} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="phone">Phone</Label>
          <Input
            id="phone"
            type="tel"
            autoComplete="off"
            placeholder="5700 1234 or +44 7700 900123"
            {...bind("phone")}
          />
          <p className="text-muted-foreground text-sm">Without a country code, the number is taken as Mauritian.</p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="off" {...bind("email")} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="country">Country</Label>
          <Input id="country" name="country" autoComplete="off" defaultValue={client?.country ?? ""} />
        </div>
      </div>
      {!client && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="notes">Notes</Label>
          <Textarea id="notes" name="notes" placeholder="Anything reception should know next time." />
        </div>
      )}
      <ClientMatchBanner matches={matches} onUse={(m) => router.push(`/clients/${m.id}`)} useLabel="Open this client" />
      <div className="flex gap-3">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Saving…" : client ? "Save changes" : "Add client"}
        </Button>
        <Button type="button" size="lg" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
