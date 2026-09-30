import { ImageResponse } from "next/og";

const SIZES = new Map([
  ["192.png", 192],
  ["512.png", 512],
]);

/** The island app's home-screen icon, drawn in the brand colours. Maskable: the mark sits well inside the safe zone. */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const size = SIZES.get(file);
  if (!size) return new Response("Not found", { status: 404 });
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#2c3792",
        color: "#ffffff",
        fontSize: size * 0.34,
        fontWeight: 700,
        letterSpacing: -size * 0.01,
      }}
    >
      <div style={{ display: "flex", borderBottom: `${size * 0.04}px solid #00adef`, paddingBottom: size * 0.02 }}>
        AS
      </div>
    </div>,
    { width: size, height: size, headers: { "cache-control": "public, max-age=86400" } },
  );
}
