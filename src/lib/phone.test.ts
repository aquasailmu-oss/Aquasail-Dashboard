import { describe, expect, it } from "vitest";
import { formatPhone, normalizePhone } from "./phone";

describe("normalizePhone", () => {
  it.each([
    ["5700 1234", "+23057001234"],
    ["57001234", "+23057001234"],
    ["263 0000", "+2302630000"],
    ["+230 5700-1234", "+23057001234"],
    ["00230 5700 1234", "+23057001234"],
    ["+44 7700 900123", "+447700900123"],
    ["0044 7700 900123", "+447700900123"],
    ["+33 6 12 34 56 78", "+33612345678"],
  ])("%s → %s", (input, expected) => {
    expect(normalizePhone(input)).toEqual({ ok: true, e164: expected });
  });

  it.each(["", "   ", "123", "abc", "+999 12"])("rejects %j with a readable message", (input) => {
    const result = normalizePhone(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/phone number/i);
  });
});

describe("formatPhone", () => {
  it("formats Mauritian and foreign numbers for reading aloud", () => {
    expect(formatPhone("+23057001234")).toBe("+230 5700 1234");
    expect(formatPhone("+447700900123")).toBe("+44 7700 900123");
  });

  it("returns an empty string for no number", () => {
    expect(formatPhone(null)).toBe("");
  });
});
