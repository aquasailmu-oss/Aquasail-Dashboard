"use client";

/** Last resort when the root layout itself fails: plain HTML, no app styles or components. */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: "40rem" }}>
        <h1>AquaSail Ops could not load</h1>
        <p>
          Check the internet connection, then try again. If it keeps happening, use the paper booking sheet and tell an
          admin.
        </p>
        <button type="button" onClick={reset} style={{ minHeight: 44, padding: "0 1.25rem", fontSize: 16 }}>
          Try again
        </button>
      </body>
    </html>
  );
}
