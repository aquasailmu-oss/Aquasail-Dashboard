import { describe, expect, it } from "vitest";
import { parseDiscount } from "./discount";

describe("parseDiscount", () => {
  it("treats an empty value as no discount", () => {
    expect(parseDiscount({ type: "amount", value: " ", reason: "" })).toEqual({ ok: true, data: null });
  });

  it("parses rupee amounts into cents", () => {
    expect(parseDiscount({ type: "amount", value: "1,500.50", reason: "Loyal guest" })).toEqual({
      ok: true,
      data: { type: "amount", value: 150050, reason: "Loyal guest" },
    });
  });

  it("parses percentages into basis points", () => {
    expect(parseDiscount({ type: "percent", value: "12.5%", reason: "Group" })).toEqual({
      ok: true,
      data: { type: "percent", value: 1250, reason: "Group" },
    });
  });

  it.each([
    [{ type: "amount", value: "500", reason: "  " }, /reason/],
    [{ type: "amount", value: "abc", reason: "x" }, /rupees/],
    [{ type: "amount", value: "0", reason: "x" }, /above zero/],
    [{ type: "percent", value: "150", reason: "x" }, /at most 100%/],
    [{ type: "percent", value: "10.555", reason: "x" }, /percentage/],
  ] as const)("rejects %j", (input, message) => {
    const result = parseDiscount(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(message);
  });
});
