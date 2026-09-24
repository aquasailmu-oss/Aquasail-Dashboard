import { describe, expect, it } from "vitest";
import { addCents, cents, formatRs, fromCents, toCents } from "./money";

describe("toCents", () => {
  it("converts whole rupee numbers", () => {
    expect(toCents(1500)).toBe(150000);
  });

  it("rounds float rupee numbers to the nearest cent", () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(19.99)).toBe(1999);
  });

  it("parses typed strings without float arithmetic", () => {
    expect(toCents("1,500")).toBe(150000);
    expect(toCents("1500.5")).toBe(150050);
    expect(toCents("Rs 1,500.05")).toBe(150005);
    expect(toCents(".5")).toBe(50);
    expect(toCents("-200")).toBe(-20000);
  });

  it("rejects garbage and over-precise input", () => {
    expect(() => toCents("abc")).toThrow();
    expect(() => toCents("")).toThrow();
    expect(() => toCents("1.234")).toThrow();
    expect(() => toCents(Number.NaN)).toThrow();
  });
});

describe("cents", () => {
  it("refuses non-integers", () => {
    expect(() => cents(1.5)).toThrow();
  });
});

describe("fromCents / addCents", () => {
  it("round-trips", () => {
    expect(fromCents(cents(150050))).toBe(1500.5);
    expect(addCents(cents(100), cents(250), cents(-50))).toBe(300);
  });
});

describe("formatRs", () => {
  it("formats whole amounts without decimals", () => {
    expect(formatRs(cents(150000))).toBe("Rs 1,500");
    expect(formatRs(cents(0))).toBe("Rs 0");
    expect(formatRs(cents(123456700))).toBe("Rs 1,234,567");
  });

  it("shows two decimals when there are cents", () => {
    expect(formatRs(cents(150050))).toBe("Rs 1,500.50");
    expect(formatRs(cents(5))).toBe("Rs 0.05");
  });

  it("formats negatives (corrections, refunds)", () => {
    expect(formatRs(cents(-20000))).toBe("-Rs 200");
  });
});
