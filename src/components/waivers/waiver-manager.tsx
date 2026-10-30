"use client";

import QRCode from "qrcode";
import { useState, useTransition } from "react";
import { createWaiverLink, getWaiverEvidence, revokeWaiverLinks } from "@/actions/waivers";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Signer = {
  id: string;
  participant_type: "adult" | "child" | "infant";
  participant_name: string;
  signer_name: string;
  signer_relationship: string;
  signed_at: string;
};

const LABEL: Record<Signer["participant_type"], string> = { adult: "Adult", child: "Child", infant: "Infant" };

export function WaiverManager({
  bookingId,
  serviceDate,
  required,
  signers,
  canManage,
}: {
  bookingId: string;
  serviceDate: string;
  required: { adult: number; child: number; infant: number };
  signers: Signer[];
  canManage: boolean;
}) {
  const [link, setLink] = useState<{ url: string; qr: string; expiresOn: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<{
    participantName: string;
    participantType: string;
    signerName: string;
    relationship: string;
    signedAt: string;
    signatureData: string;
    disclaimerText: string;
  } | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const signed = {
    adult: signers.filter((s) => s.participant_type === "adult").length,
    child: signers.filter((s) => s.participant_type === "child").length,
    infant: signers.filter((s) => s.participant_type === "infant").length,
  };
  const totalRequired = required.adult + required.child + required.infant;
  const totalSigned = signers.length;
  const complete = totalSigned >= totalRequired;

  function generateLink() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await createWaiverLink(bookingId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      try {
        const qr = await QRCode.toDataURL(result.data.url, {
          errorCorrectionLevel: "Q",
          margin: 2,
          width: 320,
          color: { dark: "#12224a", light: "#ffffff" },
        });
        setLink({ ...result.data, qr });
      } catch {
        setError("The link was created, but its QR code could not be drawn. Copy the link below instead.");
        setLink({ ...result.data, qr: "" });
      }
    });
  }

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setMessage("Waiver link copied. Send it to the group or open it on a phone to sign.");
    } catch {
      setMessage("Copy the link from the field below and send it to the group.");
    }
  }

  function revoke() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await revokeWaiverLinks(bookingId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setLink(null);
      setMessage("All active waiver links for this booking have been revoked.");
    });
  }

  async function viewEvidence(waiverId: string) {
    setError(null);
    setEvidenceLoading(waiverId);
    const result = await getWaiverEvidence(bookingId, waiverId);
    setEvidenceLoading(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setEvidence(result.data);
  }

  return (
    <Card className="mt-8">
      <CardHeader>
        <CardTitle>Participant waivers</CardTitle>
        <p className="text-muted-foreground text-sm">
          {complete
            ? `All ${totalRequired} participant${totalRequired === 1 ? " has" : "s have"} signed.`
            : `${totalSigned} of ${totalRequired} participants signed. Everyone needs an individual waiver.`}
        </p>
        <p className="text-muted-foreground text-sm">
          Adults: {signed.adult}/{required.adult} · Children: {signed.child}/{required.child} · Infants: {signed.infant}
          /{required.infant}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {signers.length > 0 && (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-left text-sm">
              <thead className="bg-secondary">
                <tr>
                  <th className="px-3 py-2">Participant</th>
                  <th className="px-3 py-2">Signed by</th>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Record</th>
                </tr>
              </thead>
              <tbody>
                {signers.map((s) => (
                  <tr key={s.id} className="border-t">
                    <td className="px-3 py-2">
                      {s.participant_name} <span className="text-muted-foreground">({LABEL[s.participant_type]})</span>
                    </td>
                    <td className="px-3 py-2">
                      {s.signer_name}
                      {s.signer_relationship !== "self"
                        ? ` · ${s.signer_relationship === "parent" ? "parent" : "legal guardian"}`
                        : ""}
                    </td>
                    <td className="px-3 py-2">{new Date(s.signed_at).toLocaleString()}</td>
                    <td className="px-3 py-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={evidenceLoading === s.id}
                        onClick={() => void viewEvidence(s.id)}
                      >
                        {evidenceLoading === s.id ? "Loading…" : "View signed record"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {error && <Alert variant="destructive">{error}</Alert>}
        {message && <Alert variant="success">{message}</Alert>}
        {canManage && (
          <div className="flex flex-wrap gap-3">
            {!complete && (
              <Button type="button" variant="outline" disabled={busy} onClick={generateLink}>
                {link ? "Replace QR / link" : "Generate waiver QR / link"}
              </Button>
            )}
            <Button type="button" variant="ghost" disabled={busy} onClick={revoke}>
              Revoke all active links
            </Button>
          </div>
        )}
        {link && (
          <div className="flex flex-col items-center gap-3 rounded-md border p-4 text-center">
            <p className="text-warning text-sm font-semibold">
              Generating a replacement later will invalidate this link and QR code.
            </p>
            {link.qr && (
              // eslint-disable-next-line @next/next/no-img-element -- QR is generated client-side as a local data URL.
              <img src={link.qr} alt="Booking waiver QR code" width={240} height={240} className="size-60" />
            )}
            <p className="text-sm">
              Scan this QR code or share the link. It expires after the service date ({serviceDate}).
            </p>
            <div className="flex w-full max-w-xl flex-wrap justify-center gap-3">
              <Button type="button" variant="outline" onClick={copyLink}>
                Copy waiver link
              </Button>
              {link.qr && (
                <a
                  className="border-border-strong inline-flex min-h-11 items-center rounded-md border px-5 font-semibold"
                  href={link.qr}
                  download={`waiver-${serviceDate}.png`}
                >
                  Download QR
                </a>
              )}
            </div>
            <input
              className="bg-background w-full max-w-xl rounded-md border px-3 py-2 text-sm"
              readOnly
              value={link.url}
              aria-label="Booking waiver link"
            />
          </div>
        )}
        {!complete && !canManage && (
          <p className="text-muted-foreground text-sm">
            Waivers are still outstanding. Ask reception to provide the booking QR code.
          </p>
        )}
      </CardContent>
      <Dialog open={!!evidence} onOpenChange={(open) => !open && setEvidence(null)}>
        {evidence && (
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Signed waiver record</DialogTitle>
              <DialogDescription>
                {evidence.participantName} (
                {LABEL[evidence.participantType as Signer["participant_type"]] ?? evidence.participantType}) · signed by{" "}
                {evidence.signerName} ·{" "}
                {evidence.relationship === "self"
                  ? "self"
                  : evidence.relationship === "parent"
                    ? "parent"
                    : "legal guardian"}{" "}
                · {new Date(evidence.signedAt).toLocaleString()}
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-md border p-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- signature evidence is a stored PNG data URL. */}
              <img
                src={evidence.signatureData}
                alt={`Signature recorded for ${evidence.participantName}`}
                className="max-h-36 max-w-full object-contain"
              />
            </div>
            <h3 className="font-semibold">Disclaimer accepted at signing</h3>
            <div className="bg-background max-h-64 overflow-y-auto rounded-md border p-3 text-sm whitespace-pre-wrap">
              {evidence.disclaimerText}
            </div>
          </DialogContent>
        )}
      </Dialog>
    </Card>
  );
}
