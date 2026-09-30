import { expect, test } from "@playwright/test";
import { db, expectTotal, login, logout, tag } from "./helpers";

// WP-26: a lost phone gets a new ticket, the old one stops working and says
// why; cancelling the booking revokes the ticket too.
test("reissue replaces the ticket with a reason; the old link says so; cancelling revokes", async ({ page }) => {
  await login(page, "receptionist");
  await page.goto("/bookings/new");
  await page.fill("#first_name", "Lost");
  await page.fill("#last_name", `Phone${tag()}`);
  await page.getByText("Adrenaline Combo", { exact: true }).click();
  await page.fill("#adults", "2");
  await expectTotal(page, "Rs 6,800");
  await page.getByRole("button", { name: "Create booking" }).click();
  await page.waitForURL(/\/confirmation$/);
  await page.getByRole("link", { name: "View booking" }).click();
  await page.waitForURL(/\/bookings\/[0-9a-f-]{36}$/);
  const bookingId = page.url().split("/").pop()!;
  await expect(page.getByTestId("ticket-state")).toHaveText("Issued");
  const first = await db.from("tickets").select("token").eq("booking_id", bookingId).single();
  const oldToken = first.data!.token;

  await page.getByRole("button", { name: "Reissue ticket" }).click();
  await page.getByRole("button", { name: "Reissue ticket" }).last().click();
  await expect(page.getByRole("dialog").getByText("Give a reason for reissuing.")).toBeVisible();
  await page.fill("#reissue_reason", "Lost phone");
  await page.getByRole("dialog").getByRole("button", { name: "Reissue ticket" }).click();
  await expect(page.getByText("New ticket issued.")).toBeVisible();

  const history = page.getByRole("list", { name: "Ticket history" });
  await expect(history.getByRole("listitem")).toHaveCount(2);
  await expect(history).toContainText("Lost phone");
  const tickets = await db.from("tickets").select("token, revoked_at").eq("booking_id", bookingId);
  expect(tickets.data?.filter((t) => !t.revoked_at)).toHaveLength(1);
  const live = tickets.data!.find((t) => !t.revoked_at)!.token;
  expect(live).not.toBe(oldToken);
  await expect(page.getByRole("link", { name: /Print ticket/ })).toHaveAttribute("href", `/tickets/${live}?print=1`);

  await page.goto(`/tickets/${oldToken}`);
  await expect(page.getByText("REPLACED BY A NEWER TICKET: THIS TICKET IS NOT VALID")).toBeVisible();

  await page.goto(`/bookings/${bookingId}`);
  await page.getByRole("button", { name: "Cancel booking" }).click();
  await page.fill("#cancel_reason", "Weather");
  await page.getByRole("dialog").getByRole("button", { name: "Cancel booking" }).click();
  await expect(page.getByText("Booking cancelled.")).toBeVisible();
  const after = await db.from("tickets").select("revoke_reason").eq("token", live).single();
  expect(after.data?.revoke_reason).toBe("Booking cancelled: Weather");
  await logout(page);
});
