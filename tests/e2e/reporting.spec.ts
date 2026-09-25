import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { login, logout } from "./helpers";

test("the Excel export ties to the register's totals", async ({ page }) => {
  await login(page, "accountant");
  await page.goto("/bookings");
  const pageCharged = (await page.locator("tfoot td").nth(2).textContent())!.trim();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: /Export to Excel/ }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^[A-Z][a-z]+_\d{4}_Bookings\.xlsx$/);
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile((await download.path())!);
  const sheet = book.getWorksheet("Bookings")!;
  const totals = sheet.getRow(sheet.rowCount);
  expect(String(totals.getCell(1).value)).toMatch(/^Totals/);
  const excelCharged = `Rs ${Number(totals.getCell(11).value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  expect(excelCharged).toBe(pageCharged);
  expect(book.getWorksheet("Lines")!.rowCount).toBeGreaterThan(1);
  await logout(page);
});

test("the daily register prints on one page", async ({ page }) => {
  await login(page, "accountant");
  await page.goto("/register");
  await expect(page.getByTestId("total-received")).toHaveText(/^Rs [\d,]+/);
  await page.emulateMedia({ media: "print" });
  const pdf = await page.pdf({ preferCSSPageSize: true });
  const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  expect(pages).toBe(1);
  await page.emulateMedia({ media: "screen" });
  await logout(page);
});
