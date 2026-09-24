import { describe, expect, it } from "vitest";
import {
  addDays,
  businessDate,
  formatDateLong,
  formatDateShort,
  formatDateTime,
  formatTime,
  parseDateInput,
} from "./dates";

describe("businessDate", () => {
  it("is already tomorrow in Mauritius when UTC is still today", () => {
    // 21:30 UTC on 16 Sep = 01:30 on 17 Sep in Mauritius (UTC+4)
    expect(businessDate(new Date("2026-09-16T21:30:00Z"))).toBe("2026-09-17");
  });

  it("matches UTC during the Mauritius day", () => {
    expect(businessDate(new Date("2026-09-17T10:00:00Z"))).toBe("2026-09-17");
  });

  it("rolls over exactly at Mauritius midnight", () => {
    expect(businessDate(new Date("2026-09-16T19:59:59Z"))).toBe("2026-09-16");
    expect(businessDate(new Date("2026-09-16T20:00:00Z"))).toBe("2026-09-17");
  });
});

describe("parseDateInput", () => {
  it("accepts valid dates", () => {
    expect(parseDateInput("2026-09-17")).toBe("2026-09-17");
    expect(parseDateInput(" 2028-02-29 ")).toBe("2028-02-29");
  });

  it("rejects impossible or malformed dates", () => {
    expect(parseDateInput("2026-02-30")).toBeNull();
    expect(parseDateInput("2027-02-29")).toBeNull();
    expect(parseDateInput("17/09/2026")).toBeNull();
    expect(parseDateInput("")).toBeNull();
  });
});

describe("addDays", () => {
  it("crosses month and year boundaries", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("formatting", () => {
  it("formats plain dates without shifting them", () => {
    expect(formatDateShort("2026-09-17")).toBe("17 Sep 2026");
    expect(formatDateShort("2026-01-01")).toBe("1 Jan 2026");
  });

  it("formats timestamps by their Mauritius date", () => {
    expect(formatDateShort(new Date("2026-09-16T21:30:00Z"))).toBe("17 Sep 2026");
  });

  it("formats long dates", () => {
    expect(formatDateLong("2026-09-17")).toBe("Thursday 17 September 2026");
  });

  it("formats times", () => {
    expect(formatTime("08:30:00")).toBe("08:30");
    expect(formatTime(new Date("2026-09-17T04:30:00Z"))).toBe("08:30");
    expect(formatDateTime("2026-09-17T04:30:00Z")).toBe("17 Sep 2026, 08:30");
  });
});
