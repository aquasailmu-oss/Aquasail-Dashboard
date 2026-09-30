"use client";

import { useState } from "react";
import { MailIcon, MessageCircleIcon } from "lucide-react";
import { sendTicketEmail } from "@/actions/delivery";
import { Button } from "@/components/ui/button";

export function ConfirmationSendButtons({
  bookingId,
  hasEmail,
  hasPhone: _hasPhone,
}: {
  bookingId: string;
  hasEmail: boolean;
  hasPhone: boolean;
}) {
  const [emailState, setEmailState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [emailMessage, setEmailMessage] = useState<string | null>(null);

  async function handleEmail() {
    setEmailState("sending");
    setEmailMessage(null);
    const res = await sendTicketEmail({ bookingId, resend: false });
    if (res.ok) {
      setEmailState("sent");
      setEmailMessage("Email sent.");
    } else {
      setEmailState("failed");
      setEmailMessage(res.error);
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex flex-wrap justify-center gap-3">
        <Button type="button" variant="ghost" disabled title="WhatsApp delivery is pending template approval">
          <MessageCircleIcon /> Send WhatsApp
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={!hasEmail || emailState === "sending" || emailState === "sent"}
          title={!hasEmail ? "No email address on this booking" : undefined}
          onClick={handleEmail}
        >
          <MailIcon />
          {emailState === "sending"
            ? "Sending…"
            : emailState === "sent"
              ? "Email sent"
              : "Send email"}
        </Button>
      </div>
      {emailMessage && (
        <p
          className={`text-sm font-semibold ${emailState === "sent" ? "text-green-600" : "text-red-600"}`}
          role="status"
        >
          {emailMessage}
        </p>
      )}
    </div>
  );
}
