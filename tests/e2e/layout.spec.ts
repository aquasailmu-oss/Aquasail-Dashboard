import { expect, test } from "@playwright/test";
import { db, login } from "./helpers";

// Reception uses tablets too (build plan WP-20): no sideways scrolling, main actions reachable.
for (const width of [768, 1024]) {
  test(`tablet ${width}px: Today, New booking and a booking fit the screen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1024 });
    await login(page, "receptionist");
    const { data: ticket } = await db
      .from("tickets")
      .select("booking_id, bookings!inner(status)")
      .eq("bookings.status", "confirmed")
      .limit(1)
      .single();
    const booking = { id: ticket!.booking_id };
    for (const [path, action] of [
      ["/today", "New booking"],
      ["/bookings/new", "Create booking"],
      [`/bookings/${booking.id}`, "Print ticket"],
    ] as const) {
      await page.goto(path);
      await expect(
        page.getByRole(path === "/bookings/new" ? "button" : "link", { name: new RegExp(action) }).first(),
      ).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${path} scrolls sideways at ${width}px`).toBeLessThanOrEqual(0);
    }
  });
}
