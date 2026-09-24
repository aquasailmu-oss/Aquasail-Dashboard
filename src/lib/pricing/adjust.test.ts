import { describe, expect, it } from "vitest";
import { cents } from "@/lib/money";
import { adjustPrice, parsePercentChange } from "./adjust";

describe("parsePercentChange", () => {
  it.each([
    ["5", 500],
    ["+7.5", 750],
    ["-10", -1000],
    ["12.25%", 1225],
    ["-90", -9000],
    ["200", 20000],
  ])("%s → %s basis points", (input, bp) => {
    expect(parsePercentChange(input)).toEqual({ ok: true, data: bp });
  });

  it.each(["", "0", "abc", "-91", "201", "5.555", "1,5"])("rejects %j", (input) => {
    expect(parsePercentChange(input).ok).toBe(false);
  });
});

describe("adjustPrice", () => {
  it("rounds to the nearest whole rupee, half up", () => {
    expect(adjustPrice(cents(185000), 500)).toBe(194300); // 1,942.50 → 1,943
    expect(adjustPrice(cents(170000), 500)).toBe(178500);
    expect(adjustPrice(cents(99900), 1000)).toBe(109900); // 1,098.90 → 1,099
    expect(adjustPrice(cents(100000), -333)).toBe(96700); // 966.70 → 967
  });

  it("handles cuts and zero prices", () => {
    expect(adjustPrice(cents(120000), -1000)).toBe(108000);
    expect(adjustPrice(cents(0), 500)).toBe(0);
  });

  it("stays exact on large amounts", () => {
    expect(adjustPrice(cents(9_999_999_900), 1)).toBe(10_000_999_900);
  });
});
