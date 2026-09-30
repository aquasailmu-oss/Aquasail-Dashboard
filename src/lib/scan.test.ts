import { describe, expect, it } from "vitest";
import { partySize, scanResultSchema, tokenFromQr } from "./scan";

const TOKEN = "0123456789abcdef0123456789abcdef";

describe("tokenFromQr", () => {
  it("reads the token from the ticket URL the QR encodes", () => {
    expect(tokenFromQr(`https://ops.aquasail.mu/tickets/${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromQr(`http://localhost:3000/tickets/${TOKEN}?print=1`)).toBe(TOKEN);
    expect(tokenFromQr(` ${TOKEN} `)).toBe(TOKEN);
  });

  it("rejects anything that is not an AquaSail ticket", () => {
    expect(tokenFromQr("https://example.com/")).toBeNull();
    expect(tokenFromQr(`https://ops.aquasail.mu/tickets/${TOKEN}extra`)).toBeNull();
    expect(tokenFromQr("WS-20260929-0042")).toBeNull();
    expect(tokenFromQr(TOKEN.toUpperCase())).toBeNull();
  });
});

describe("partySize", () => {
  it("names each kind of participant", () => {
    expect(partySize({ adults: 4, children: 1, infants: 0 })).toBe("4 adults, 1 child");
    expect(partySize({ adults: 1, children: 0, infants: 2 })).toBe("1 adult, 2 infants");
  });
});

describe("scanResultSchema", () => {
  it("accepts NOT_FOUND on its own", () => {
    expect(scanResultSchema.parse({ verdict: "NOT_FOUND" })).toEqual({ verdict: "NOT_FOUND" });
  });

  it("refuses a verdict it does not know", () => {
    expect(scanResultSchema.safeParse({ verdict: "MAYBE" }).success).toBe(false);
  });
});
