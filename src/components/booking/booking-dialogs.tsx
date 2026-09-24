"use client";

import { useState } from "react";
import { toast } from "sonner";
import { cancelBooking, correctPayment, recordPayment } from "@/actions/bookings";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatRs, fromCents, type Cents } from "@/lib/money";
import type { Result } from "@/lib/result";
import { useServerForm } from "@/lib/use-server-form";

/** A dialog wrapping one Server Action form; closes and toasts on success. */
function ActionDialog({
  trigger,
  title,
  description,
  action,
  success,
  submitLabel,
  destructive,
  children,
}: {
  trigger: React.ReactNode;
  title: string;
  description: React.ReactNode;
  action: (formData: FormData) => Promise<Result<null>>;
  success: string;
  submitLabel: string;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { result, pending, onSubmit, reset } = useServerForm(action, {
    onSuccess: () => {
      setOpen(false);
      toast.success(success);
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild>
            <div>{description}</div>
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          {result && !result.ok && <Alert variant="destructive">{result.error}</Alert>}
          {children}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Back
              </Button>
            </DialogClose>
            <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={pending}>
              {pending ? "Saving…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RecordPaymentDialog({
  bookingId,
  due,
  payer,
}: {
  bookingId: string;
  due: Cents;
  payer: "client" | "operator";
}) {
  return (
    <ActionDialog
      trigger={<Button variant="outline">Record payment</Button>}
      title="Record a payment"
      description={`Balance due: ${formatRs(due)}.`}
      action={recordPayment}
      success="Payment recorded."
      submitLabel="Record payment"
    >
      <input type="hidden" name="booking_id" value={bookingId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="pay_amount">Amount (Rs)</Label>
          <Input
            id="pay_amount"
            name="amount"
            inputMode="decimal"
            autoFocus
            defaultValue={due > 0 ? String(fromCents(due)) : ""}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="pay_method">Method</Label>
          <select
            id="pay_method"
            name="method"
            defaultValue={payer === "operator" ? "operator_account" : "cash"}
            className="border-input bg-card min-h-11 rounded-md border px-3"
          >
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="bank_transfer">Bank transfer</option>
            <option value="operator_account">Operator account</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="pay_reference">Reference (optional)</Label>
        <Input id="pay_reference" name="reference" placeholder="Card slip or transfer number" />
      </div>
      <input type="hidden" name="note" value="" />
    </ActionDialog>
  );
}

export function CorrectPaymentDialog({
  paymentId,
  amount,
  label,
}: {
  paymentId: string;
  amount: Cents;
  label: string;
}) {
  return (
    <ActionDialog
      trigger={
        <Button variant="ghost" size="sm" aria-label={`Correct payment ${label}`}>
          Correct
        </Button>
      }
      title="Correct a payment"
      description={
        <>
          Payments are never edited or deleted. A correction adds a negative line that cancels all or part of {label};
          both stay on the booking for good. Use this for a mistyped amount, a payment entered twice, or a refund.
        </>
      }
      action={correctPayment}
      success="Correction recorded."
      submitLabel="Record correction"
      destructive
    >
      <input type="hidden" name="payment_id" value={paymentId} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="corr_amount">Amount to reverse (Rs)</Label>
        <Input id="corr_amount" name="amount" inputMode="decimal" autoFocus defaultValue={String(fromCents(amount))} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="corr_note">Why (required)</Label>
        <Textarea id="corr_note" name="note" placeholder="Entered twice / refund, trip cancelled for weather" />
      </div>
    </ActionDialog>
  );
}

export function CancelBookingDialog({ bookingId, paid }: { bookingId: string; paid: Cents }) {
  return (
    <ActionDialog
      trigger={<Button variant="outline">Cancel booking</Button>}
      title="Cancel this booking?"
      description="The booking is kept, struck through, with your reason. Nothing is deleted."
      action={cancelBooking}
      success="Booking cancelled."
      submitLabel="Cancel booking"
      destructive
    >
      <input type="hidden" name="booking_id" value={bookingId} />
      {paid > 0 && (
        <Alert variant="warning">
          {formatRs(paid)} has been paid. Cancelling does not refund it: record the refund afterwards with
          &ldquo;Correct&rdquo; on the payment.
        </Alert>
      )}
      <div className="flex flex-col gap-2">
        <Label htmlFor="cancel_reason">Reason (required)</Label>
        <Textarea id="cancel_reason" name="reason" autoFocus placeholder="Weather / guest unwell / booked twice" />
      </div>
    </ActionDialog>
  );
}
