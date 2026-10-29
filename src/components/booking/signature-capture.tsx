"use client";

import { useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SignatureCapture({
  disclaimer,
  signerName,
  onSignerNameChange,
  onSignatureChange,
  acknowledged,
  onAcknowledgedChange,
}: {
  disclaimer: string;
  signerName: string;
  onSignerNameChange: (name: string) => void;
  onSignatureChange: (signature: string | null) => void;
  acknowledged: boolean;
  onAcknowledgedChange: (value: boolean) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const hasStroke = useRef(false);
  const [hasSignature, setHasSignature] = useState(false);
  const placeholder = disclaimer.startsWith("DISCLAIMER PLACEHOLDER");

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    canvas.setPointerCapture(event.pointerId);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    hasStroke.current = false;
    const p = point(event);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#12224a";
    drawing.current = true;
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const p = point(event);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    hasStroke.current = true;
  }

  function finish() {
    if (!drawing.current) return;
    drawing.current = false;
    if (!hasStroke.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    setHasSignature(true);
    onSignatureChange(canvas.toDataURL("image/png"));
  }

  function clear() {
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    drawing.current = false;
    hasStroke.current = false;
    setHasSignature(false);
    onSignatureChange(null);
    onAcknowledgedChange(false);
  }

  return (
    <div className="border-border flex flex-col gap-4 rounded-md border p-4" data-testid="signature-capture">
      <div>
        <h3 className="font-semibold">Customer disclaimer and e-signature</h3>
        <p className="text-muted-foreground text-sm">A signature is optional when saving an unsigned pre-booking.</p>
      </div>
      {placeholder && (
        <Alert variant="warning">
          Placeholder disclaimer: replace this text with owner-approved wording in Settings.
        </Alert>
      )}
      <div
        className="max-h-40 overflow-y-auto rounded border p-3 text-sm whitespace-pre-wrap"
        data-testid="disclaimer-text"
      >
        {disclaimer}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="signer_name">Signer name</Label>
        <Input
          id="signer_name"
          value={signerName}
          onChange={(event) => onSignerNameChange(event.target.value)}
          autoComplete="name"
          maxLength={160}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="customer_signature">Sign here using touch or mouse</Label>
        <canvas
          ref={canvasRef}
          id="customer_signature"
          width={1000}
          height={260}
          aria-label="Customer signature pad"
          className="bg-card border-input h-28 w-full rounded-md border"
          style={{ touchAction: "none" }}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={finish}
          onPointerCancel={finish}
        />
        <div className="flex items-center justify-between gap-3">
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={acknowledged}
              disabled={!hasSignature}
              onChange={(event) => onAcknowledgedChange(event.target.checked)}
              className="accent-primary size-5"
            />
            I have read and agree to the disclaimer above.
          </label>
          <Button type="button" variant="outline" onClick={clear} disabled={!hasSignature}>
            Clear signature
          </Button>
        </div>
      </div>
    </div>
  );
}
