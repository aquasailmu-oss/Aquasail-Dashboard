"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { submitPublicWaiver, type PublicWaiverState } from "@/actions/waivers";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function PublicWaiverForm({ token, waiver }: { token: string; waiver: PublicWaiverState }) {
  const router = useRouter();
  const [participantType, setParticipantType] = useState<"adult" | "child" | "infant">(() => {
    if ((waiver.adult_required ?? 0) > (waiver.adult_signed ?? 0)) return "adult";
    if ((waiver.child_required ?? 0) > (waiver.child_signed ?? 0)) return "child";
    return "infant";
  });
  const [participantName, setParticipantName] = useState("");
  const [signerName, setSignerName] = useState("");
  const [relationship, setRelationship] = useState<"self" | "parent" | "legal_guardian">("self");
  const [acknowledged, setAcknowledged] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [guardianConfirmed, setGuardianConfirmed] = useState(false);
  const [padVersion, setPadVersion] = useState(0);
  const submissionId = useRef(crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [busy, startTransition] = useTransition();

  const required = {
    adult: waiver.adult_required ?? 0,
    child: waiver.child_required ?? 0,
    infant: waiver.infant_required ?? 0,
  };
  const signed = {
    adult: waiver.adult_signed ?? 0,
    child: waiver.child_signed ?? 0,
    infant: waiver.infant_signed ?? 0,
  };
  const remaining = {
    adult: Math.max(0, required.adult - signed.adult),
    child: Math.max(0, required.child - signed.child),
    infant: Math.max(0, required.infant - signed.infant),
  };
  const remainingTotal = remaining.adult + remaining.child + remaining.infant;

  function chooseType(value: "adult" | "child" | "infant") {
    setParticipantType(value);
    setRelationship(value === "adult" ? "self" : "parent");
    setSignerName("");
    setSignature(null);
    setGuardianConfirmed(false);
    setAcknowledged(false);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!signature) return setError("Add your signature before submitting.");
    if (!acknowledged) return setError("Read the waiver and confirm that you agree before submitting.");
    const isSelf = participantType === "adult" && relationship === "self";
    const actualSignerName = isSelf ? participantName : signerName;
    if (!actualSignerName.trim()) return setError("Enter the name of the person signing.");

    startTransition(async () => {
      const result = await submitPublicWaiver({
        token,
        participant_type: participantType,
        participant_name: participantName,
        signer_name: actualSignerName,
        signer_relationship: relationship,
        signature_data: signature,
        guardian_authority_confirmed: relationship !== "self" && guardianConfirmed,
        submission_id: submissionId.current,
        acknowledged: true,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSuccess(true);
      setParticipantName("");
      setSignerName("");
      setSignature(null);
      setAcknowledged(false);
      setGuardianConfirmed(false);
      setPadVersion((version) => version + 1);
      submissionId.current = crypto.randomUUID();
      router.refresh();
    });
  }

  if (waiver.complete || remainingTotal === 0) {
    return <Alert variant="success">All participants on this booking have signed. Thank you.</Alert>;
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="bg-secondary rounded-md p-4 text-sm" role="status">
        <strong>
          {waiver.signed_count ?? 0} of {waiver.required_count ?? 0} signed.
        </strong>
        <span className="ml-2">
          Remaining: {remaining.adult} adult, {remaining.child} child, {remaining.infant} infant.
        </span>
      </div>
      {success && (
        <Alert variant="success">
          Your waiver has been saved. If other people are signing, they can continue here.
        </Alert>
      )}
      {error && <Alert variant="destructive">{error}</Alert>}
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <div className="flex flex-col gap-2">
          <Label htmlFor="participant_type">Participant type</Label>
          <select
            id="participant_type"
            className="border-input bg-background min-h-11 rounded-md border px-3"
            value={participantType}
            onChange={(event) => chooseType(event.target.value as "adult" | "child" | "infant")}
          >
            {(["adult", "child", "infant"] as const).map((type) => (
              <option key={type} value={type} disabled={remaining[type] === 0}>
                {type[0].toUpperCase() + type.slice(1)} · {remaining[type]} remaining
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="participant_name">Participant full name</Label>
          <Input
            id="participant_name"
            autoComplete="name"
            maxLength={160}
            required
            value={participantName}
            onChange={(e) => setParticipantName(e.target.value)}
          />
        </div>
        {participantType === "adult" && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="signer_relationship">Who is signing?</Label>
            <select
              id="signer_relationship"
              className="border-input bg-background min-h-11 rounded-md border px-3"
              value={relationship}
              onChange={(e) => setRelationship(e.target.value as "self" | "parent" | "legal_guardian")}
            >
              <option value="self">I am signing for myself</option>
              <option value="parent">Parent signing for this participant</option>
              <option value="legal_guardian">Legal guardian signing for this participant</option>
            </select>
          </div>
        )}
        {participantType !== "adult" && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="signer_relationship">Relationship to participant</Label>
            <select
              id="signer_relationship"
              className="border-input bg-background min-h-11 rounded-md border px-3"
              value={relationship}
              onChange={(e) => setRelationship(e.target.value as "parent" | "legal_guardian")}
            >
              <option value="parent">Parent</option>
              <option value="legal_guardian">Legal guardian</option>
            </select>
          </div>
        )}
        {(participantType !== "adult" || relationship !== "self") && (
          <>
            {participantType !== "adult" && (
              <p className="text-muted-foreground text-sm">
                A parent or legal guardian must complete this waiver for the child or infant.
              </p>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="signer_name">
                {participantType === "adult"
                  ? "Parent or legal guardian full name"
                  : "Parent or legal guardian full name"}
              </Label>
              <Input
                id="signer_name"
                autoComplete="name"
                maxLength={160}
                required
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
              />
            </div>
          </>
        )}
        {(participantType !== "adult" || relationship !== "self") && (
          <label className="flex min-h-11 items-start gap-3 text-sm">
            <input
              className="accent-primary mt-1 size-5 shrink-0"
              type="checkbox"
              checked={guardianConfirmed}
              onChange={(e) => setGuardianConfirmed(e.target.checked)}
            />
            <span>
              I confirm I am this participant&rsquo;s parent or legal guardian and am authorized to sign for them.
            </span>
          </label>
        )}
        <div
          className="bg-card max-h-64 overflow-y-auto rounded-md border p-4 text-sm whitespace-pre-wrap"
          tabIndex={0}
          aria-label="Waiver text"
        >
          {waiver.disclaimer_text}
        </div>
        <label className="flex min-h-11 items-start gap-3 text-sm">
          <input
            className="accent-primary mt-1 size-5 shrink-0"
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
          />
          <span>I have read the waiver above and intend to sign it for the named participant.</span>
        </label>
        <WaiverSignaturePad key={padVersion} onChange={setSignature} />
        <Button
          type="submit"
          size="lg"
          disabled={busy || !signature || !acknowledged || (relationship !== "self" && !guardianConfirmed)}
        >
          {busy ? "Saving waiver…" : "Sign and submit waiver"}
        </Button>
      </form>
    </div>
  );
}

function WaiverSignaturePad({ onChange }: { onChange: (value: string | null) => void }) {
  const [hasSignature, setHasSignature] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const hasStroke = useRef(false);

  function getPoint(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    hasStroke.current = false;
    const point = getPoint(event);
    context.beginPath();
    context.moveTo(point.x, point.y);
    context.lineWidth = 4;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#12224a";
    drawing.current = true;
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    const point = getPoint(event);
    context.lineTo(point.x, point.y);
    context.stroke();
    hasStroke.current = true;
    setHasSignature(true);
  }

  function finish(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    drawing.current = false;
    if (hasStroke.current) {
      setHasSignature(true);
      onChange(event.currentTarget.toDataURL("image/png"));
    }
  }

  function clear() {
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
    onChange(null);
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="waiver_signature">Signature</Label>
      <canvas
        ref={canvasRef}
        id="waiver_signature"
        width={1000}
        height={280}
        aria-label="Sign the waiver using touch or mouse"
        className="bg-card border-input h-36 w-full rounded-md border"
        style={{ touchAction: "none" }}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={finish}
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground text-sm">Sign using your finger or mouse.</span>
        <Button type="button" variant="outline" size="sm" onClick={clear} disabled={!hasSignature}>
          Clear
        </Button>
      </div>
    </div>
  );
}
