"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPreRegistration } from "@/actions/pre-registrations";
import { findSimilarClients, type ClientMatch } from "@/actions/clients";
import { ClientMatchBanner } from "@/components/clients/client-match-banner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPhone } from "@/lib/phone";

type Operator = { id: string; name: string };

export function PreRegistrationForm({ operators, today }: { operators: Operator[]; today: string }) {
  const router = useRouter();
  const [client, setClient] = useState({ first_name: "", last_name: "", phone: "", email: "", country: "" });
  const [chosenClient, setChosenClient] = useState<ClientMatch | null>(null);
  const [matches, setMatches] = useState<ClientMatch[]>([]);
  const [operatorId, setOperatorId] = useState("");
  const [serviceDate, setServiceDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  useEffect(() => {
    if (chosenClient) {
      setMatches([]);
      return;
    }
    const { first_name, last_name, phone, email } = client;
    if (!phone && !email && first_name.length + last_name.length < 4) {
      setMatches([]);
      return;
    }
    const timer = setTimeout(async () => {
      const result = await findSimilarClients({ first_name, last_name, phone, email });
      setMatches(result.ok ? result.data : []);
    }, 300);
    return () => clearTimeout(timer);
  }, [client, chosenClient]);

  const setField = (name: keyof typeof client) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value;
    setClient((current) => ({ ...current, [name]: next }));
    setChosenClient(null);
    setError(null);
  };

  function selectClient(match: ClientMatch) {
    setChosenClient(match);
    setClient({
      first_name: match.first_name,
      last_name: match.last_name,
      phone: match.phone_e164,
      email: match.email,
      country: match.country,
    });
    setMatches([]);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!operatorId) return setError("Choose a tour operator.");
    startSaving(async () => {
      const result = await createPreRegistration({
        client_id: chosenClient?.id ?? null,
        ...client,
        operator_id: operatorId,
        service_date: serviceDate,
        notes,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/pre-registrations?saved=${result.data.id}`);
    });
  }

  return (
    <form className="flex max-w-3xl flex-col gap-6" onSubmit={submit} noValidate>
      {error && <Alert variant="destructive">{error}</Alert>}
      <section className="bg-card flex flex-col gap-4 rounded-lg border p-5">
        <h2 className="font-display text-lg font-semibold">Client details</h2>
        {chosenClient ? (
          <div className="border-success bg-success-surface flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3">
            <div>
              <p className="font-semibold">
                {chosenClient.first_name} {chosenClient.last_name}
              </p>
              <p className="text-muted-foreground text-sm">
                {[formatPhone(chosenClient.phone_e164), chosenClient.email].filter(Boolean).join(" · ")}
              </p>
            </div>
            <Button type="button" variant="outline" onClick={() => setChosenClient(null)}>
              Change client
            </Button>
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="pre-first-name">First name</Label>
                <Input
                  id="pre-first-name"
                  autoFocus
                  required
                  value={client.first_name}
                  onChange={setField("first_name")}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="pre-last-name">Last name</Label>
                <Input id="pre-last-name" value={client.last_name} onChange={setField("last_name")} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="pre-phone">
                  Phone <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Input
                  id="pre-phone"
                  type="tel"
                  placeholder="5700 1234"
                  value={client.phone}
                  onChange={setField("phone")}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="pre-email">
                  Email <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Input id="pre-email" type="email" value={client.email} onChange={setField("email")} />
              </div>
              <div className="flex flex-col gap-2 sm:col-span-2">
                <Label htmlFor="pre-country">
                  Country <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Input id="pre-country" value={client.country} onChange={setField("country")} />
              </div>
            </div>
            <ClientMatchBanner matches={matches} onUse={selectClient} />
          </>
        )}
      </section>

      <section className="bg-card flex flex-col gap-4 rounded-lg border p-5">
        <h2 className="font-display text-lg font-semibold">Visit details</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="pre-operator">Tour operator</Label>
            <select
              id="pre-operator"
              className="border-input bg-card min-h-11 rounded-md border px-3"
              value={operatorId}
              onChange={(e) => setOperatorId(e.target.value)}
              required
            >
              <option value="">Choose an operator…</option>
              {operators.map((operator) => (
                <option key={operator.id} value={operator.id}>
                  {operator.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="pre-date">Visit date</Label>
            <Input
              id="pre-date"
              type="date"
              min={today}
              value={serviceDate}
              onChange={(e) => setServiceDate(e.target.value || today)}
              required
            />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="pre-notes">
            Staff note <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Input
            id="pre-notes"
            value={notes}
            maxLength={1000}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything staff should know when completing the booking"
          />
        </div>
      </section>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" size="lg" disabled={saving || operators.length === 0}>
          {saving ? "Saving…" : "Save pre-registration"}
        </Button>
        <Button type="button" size="lg" variant="outline" onClick={() => router.push("/pre-registrations")}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
