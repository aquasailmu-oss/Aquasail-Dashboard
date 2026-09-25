"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveOperator } from "@/actions/operators";
import { PayerBanner } from "@/components/shared/payer-banner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PAYERS, SETTLEMENT_MODELS, type Payer, type SettlementModel } from "@/lib/operators";
import { formatPhone } from "@/lib/phone";
import { openAfterSave } from "@/lib/navigate";
import { useServerForm } from "@/lib/use-server-form";
import { cn } from "@/lib/utils";

type Operator = {
  id: string;
  code: string;
  name: string;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  settlement_model: SettlementModel;
  default_commission_rate: number | null;
  payer: Payer;
  notes: string | null;
};

function Choice({
  name,
  value,
  checked,
  onChange,
  title,
  body,
  danger,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  title: string;
  body?: string;
  danger?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer gap-3 rounded-md border-2 p-3",
        checked ? (danger ? "border-destructive bg-destructive-surface" : "border-primary bg-accent") : "border-border",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="accent-primary mt-1 size-5 shrink-0"
      />
      <span>
        <span className={cn("block font-semibold", danger && "text-destructive")}>{title}</span>
        {body && <span className="text-muted-foreground text-sm">{body}</span>}
      </span>
    </label>
  );
}

export function OperatorForm({ operator }: { operator?: Operator }) {
  const router = useRouter();
  const [model, setModel] = useState<SettlementModel>(operator?.settlement_model ?? "commission");
  const [payer, setPayer] = useState<Payer>(operator?.payer ?? "client");
  const [name, setName] = useState(operator?.name ?? "");
  const { result, pending, onSubmit } = useServerForm(saveOperator, {
    onSuccess: ({ id }) => openAfterSave(`/admin/operators/${id}`),
  });

  return (
    <form onSubmit={onSubmit} className="flex max-w-3xl flex-col gap-6" noValidate>
      {result && !result.ok && <Alert variant="destructive">{result.error}</Alert>}
      {operator && <input type="hidden" name="id" value={operator.id} />}
      <Card>
        <CardContent className="grid gap-5 pt-6 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="code">Code</Label>
            {operator ? (
              <Input id="code" value={operator.code} readOnly disabled className="font-mono" />
            ) : (
              <>
                <Input
                  id="code"
                  name="code"
                  className="font-mono uppercase"
                  placeholder="VERANDA"
                  autoComplete="off"
                  autoFocus
                  required
                />
                <p className="text-warning text-sm font-semibold">The code cannot be changed once saved.</p>
              </>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="contact_name">Contact person</Label>
            <Input id="contact_name" name="contact_name" defaultValue={operator?.contact_name ?? ""} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="contact_phone">Contact phone</Label>
            <Input
              id="contact_phone"
              name="contact_phone"
              type="tel"
              defaultValue={formatPhone(operator?.contact_phone)}
            />
          </div>
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="contact_email">Contact email</Label>
            <Input id="contact_email" name="contact_email" type="email" defaultValue={operator?.contact_email ?? ""} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How is our price worked out?</CardTitle>
          <CardDescription>This decides what AquaSail earns on each booking.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <fieldset className="flex flex-col gap-3">
            <legend className="sr-only">Settlement model</legend>
            {(Object.keys(SETTLEMENT_MODELS) as SettlementModel[]).map((m) => (
              <Choice
                key={m}
                name="settlement_model"
                value={m}
                checked={model === m}
                onChange={() => setModel(m)}
                title={SETTLEMENT_MODELS[m].label}
                body={SETTLEMENT_MODELS[m].explanation}
              />
            ))}
          </fieldset>
          {model === "commission" && (
            <div className="flex max-w-xs flex-col gap-2">
              <Label htmlFor="commission_percent">Commission (%)</Label>
              <Input
                id="commission_percent"
                name="commission_percent"
                inputMode="decimal"
                placeholder="20"
                defaultValue={
                  operator?.default_commission_rate
                    ? String(Number((operator.default_commission_rate * 100).toFixed(2)))
                    : ""
                }
                required
              />
            </div>
          )}
          {model === "net_rate" && <Alert>Net prices are set per activity for this operator in Pricing.</Alert>}
          {model !== "commission" && <input type="hidden" name="commission_percent" value="" />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Who hands us the money?</CardTitle>
          <CardDescription>A separate question from the one above.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-3">
            <legend className="sr-only">Payer</legend>
            <Choice
              name="payer"
              value="client"
              checked={payer === "client"}
              onChange={() => setPayer("client")}
              title={PAYERS.client.label}
            />
            <Choice
              name="payer"
              value="operator"
              checked={payer === "operator"}
              onChange={() => setPayer("operator")}
              title={PAYERS.operator.label}
              body="The booking is left unpaid and the amount is owed by the operator."
              danger
            />
          </fieldset>
          <div>
            <div className="text-muted-foreground mb-2 text-sm font-semibold">
              Reception will see this on every booking:
            </div>
            <PayerBanner operatorName={name || "This operator"} payer={payer} />
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          name="notes"
          defaultValue={operator?.notes ?? ""}
          placeholder="Agreement details, who to call for settlement."
        />
      </div>

      <div className="flex gap-3">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Saving…" : operator ? "Save operator" : "Add operator"}
        </Button>
        <Button type="button" size="lg" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
