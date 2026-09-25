import { describe, expect, it } from "vitest";
import { formatRate, parsePercent } from "./operators";

describe("parsePercent", () => {
  it.each([
    ["20", 0.2],
    ["15.5", 0.155],
    ["12.25 %", 0.1225],
    ["0.01", 0.0001],
    ["100", 1],
  ])("%s → %s", (input, rate) => {
    expect(parsePercent(input)).toEqual({ ok: true, data: rate });
  });

  it.each(["", "abc", "0", "100.01", "12.345", "-5", "1,5"])("rejects %j", (input) => {
    expect(parsePercent(input).ok).toBe(false);
  });
});

describe("formatRate", () => {
  it("shows a stored rate as a percentage", () => {
    expect(formatRate(0.2)).toBe("20%");
    expect(formatRate(0.155)).toBe("15.5%");
    expect(formatRate(0.1225)).toBe("12.25%");
    expect(formatRate(null)).toBe("");
  });
});
