import { describe, expect, it } from "vitest";
import { landingPath } from "./navigation";

describe("landingPath", () => {
  it("sends booking staff to operator selection, accountants to Today, and activity staff to Scan", () => {
    expect(landingPath("admin")).toBe("/bookings/new");
    expect(landingPath("receptionist")).toBe("/bookings/new");
    expect(landingPath("accountant")).toBe("/today");
    expect(landingPath("activity_staff")).toBe("/scan");
  });
});
