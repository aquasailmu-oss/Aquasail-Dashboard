"use client";

import { registerDevice } from "@/actions/island";
import { signOut } from "@/actions/auth";
import { useServerForm } from "@/lib/use-server-form";

/**
 * Shown when this tablet is not (or no longer) a registered device. Only a
 * supervisor or an admin can register it; everyone else is told who to ask.
 */
export function DeviceSetup({
  staffName,
  reason,
  locations,
}: {
  staffName: string;
  /** Why the device cannot be used, e.g. "This device has been deactivated. Ask a supervisor." */
  reason: string;
  /** Where a device can be used; empty for someone who cannot register one. */
  locations: { id: string; name: string }[];
}) {
  const { result, pending, onSubmit } = useServerForm(registerDevice);
  return (
    <div className="flex min-h-dvh flex-col gap-5 bg-white p-5 text-lg text-[#0a0a0a]">
      <h1 className="font-display text-3xl font-bold">Island app</h1>
      <p className="rounded-xl bg-[#fbbf24] p-4 text-xl font-bold" role="alert">
        {reason}
      </p>

      {locations.length > 0 && (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <h2 className="text-2xl font-bold">Register this device</h2>
          <p>
            Give it a name people will recognise, and say where it is used. Staff then sign in on it at the start of
            each shift.
          </p>
          {result && !result.ok && (
            <p role="alert" className="rounded-lg bg-[#f87171] p-3 font-bold">
              {result.error}
            </p>
          )}
          <label htmlFor="label" className="font-bold">
            Device name
          </label>
          <input
            id="label"
            name="label"
            placeholder="Island tablet 3"
            autoComplete="off"
            className="min-h-14 rounded-xl border-4 border-[#0a0a0a] px-4 text-xl"
          />
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 font-bold">Used at</legend>
            {locations.map((l, i) => (
              <label key={l.id} className="flex min-h-14 items-center gap-3 rounded-xl border-2 border-[#0a0a0a] px-4">
                <input type="radio" name="location_id" value={l.id} defaultChecked={i === 0} className="size-6" />
                {l.name}
              </label>
            ))}
          </fieldset>
          <button
            type="submit"
            disabled={pending}
            className="min-h-16 rounded-xl bg-[#0a0a0a] text-2xl font-bold text-white disabled:opacity-60"
          >
            {pending ? "Registering…" : "REGISTER DEVICE"}
          </button>
        </form>
      )}

      <form action={signOut} className="mt-auto">
        <p className="mb-2">Signed in as {staffName}.</p>
        <button type="submit" className="min-h-14 w-full rounded-xl border-4 border-[#0a0a0a] text-xl font-bold">
          Sign out
        </button>
      </form>
    </div>
  );
}
