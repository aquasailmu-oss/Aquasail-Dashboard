import ExcelJS from "exceljs";
import { NextResponse, type NextRequest } from "next/server";
import { authorize } from "@/lib/auth";
import { addDays } from "@/lib/dates";
import { cents, fromCents } from "@/lib/money";
import { parseRegisterFilters, registerQuery, type RegisterRow } from "@/lib/register";
import { createClient } from "@/lib/supabase/server";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const PAYMENT = {
  paid: "Paid",
  part_paid: "Part paid",
  unpaid: "Unpaid",
  operator_account: "Operator account",
} as const;
const STATUS = { confirmed: "Confirmed", completed: "Completed", no_show: "No-show", cancelled: "Cancelled" } as const;
const MONEY = "#,##0.00";

/** "September_2026_Bookings.xlsx" for a whole month, otherwise the exact range. */
function fileName(from: string, to: string): string {
  const wholeMonth = from.endsWith("-01") && addDays(to, 1).endsWith("-01") && from.slice(0, 7) === to.slice(0, 7);
  if (wholeMonth) return `${MONTHS[Number(from.slice(5, 7)) - 1]}_${from.slice(0, 4)}_Bookings.xlsx`;
  return `Bookings_${from}_to_${to}.xlsx`;
}

type ItemRow = {
  booking_id: string;
  participant_type: string;
  quantity: number;
  unit_retail_cents: number;
  unit_charged_cents: number;
  unit_operator_net_cents: number | null;
  commission_rate: number | null;
  commission_cents: number;
  discount_cents: number;
  discount_reason: string | null;
  sort_order: number;
  packages: { name: string } | null;
  activities: { name: string } | null;
};

/**
 * The booking register as a real .xlsx, for exactly the filters on screen.
 * Sheet 1: one row per booking, with a totals row that ties to the page
 * (cancelled bookings excluded from totals). Sheet 2: the booking lines.
 * Money is exported as numbers in rupees so the accountant can sum it.
 */
export async function GET(request: NextRequest) {
  const auth = await authorize(["admin", "accountant"]);
  if (!auth.ok) return new NextResponse(auth.error, { status: 403 });

  const f = parseRegisterFilters(Object.fromEntries(request.nextUrl.searchParams));
  const supabase = await createClient();
  const { data: rows, error } = await registerQuery(supabase, f, "*")
    .order("service_date")
    .order("reference")
    .overrideTypes<RegisterRow[], { merge: false }>();
  if (error) return new NextResponse("The export could not be prepared. Try again.", { status: 500 });

  const items: ItemRow[] = [];
  for (let i = 0; i < rows.length; i += 200) {
    const { data, error: e } = await supabase
      .from("booking_items")
      .select(
        "booking_id, participant_type, quantity, unit_retail_cents, unit_charged_cents, unit_operator_net_cents, commission_rate, commission_cents, discount_cents, discount_reason, sort_order, packages(name), activities(name)",
      )
      .in(
        "booking_id",
        rows.slice(i, i + 200).map((r) => r.id),
      );
    if (e) return new NextResponse("The export could not be prepared. Try again.", { status: 500 });
    items.push(...data);
  }

  const rupees = (c: number) => fromCents(cents(c));
  const book = new ExcelJS.Workbook();
  book.creator = "AquaSail Ops";

  const sheet = book.addWorksheet("Bookings", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { header: "Reference", key: "reference", width: 20 },
    { header: "Service date", key: "service_date", width: 13 },
    { header: "Client", key: "client", width: 26 },
    { header: "Source", key: "source", width: 22 },
    { header: "Booked", key: "summary", width: 32 },
    { header: "People", key: "people", width: 8 },
    { header: "Status", key: "status", width: 12 },
    { header: "Payment", key: "payment", width: 16 },
    { header: "Retail (Rs)", key: "retail", width: 13, style: { numFmt: MONEY } },
    { header: "Discount (Rs)", key: "discount", width: 13, style: { numFmt: MONEY } },
    { header: "Charged (Rs)", key: "charged", width: 13, style: { numFmt: MONEY } },
    { header: "Paid (Rs)", key: "paid", width: 13, style: { numFmt: MONEY } },
    { header: "Balance (Rs)", key: "balance", width: 13, style: { numFmt: MONEY } },
    { header: "Operator net (Rs)", key: "net", width: 16, style: { numFmt: MONEY } },
    { header: "Commission (Rs)", key: "commission", width: 15, style: { numFmt: MONEY } },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const r of rows) {
    sheet
      .addRow({
        reference: r.reference,
        service_date: new Date(`${r.service_date}T00:00:00Z`),
        client: r.client_name,
        source: r.operator_name ?? "Walk-in",
        summary: r.summary,
        people: r.people,
        status: STATUS[r.status],
        payment: PAYMENT[r.payment_status],
        retail: rupees(r.retail_total_cents),
        discount: rupees(r.discount_total_cents),
        charged: rupees(r.charged_total_cents),
        paid: rupees(r.paid_cents),
        balance: rupees(r.balance_cents),
        net: rupees(r.operator_net_total_cents),
        commission: rupees(r.commission_total_cents),
      })
      .getCell("service_date").numFmt = "dd mmm yyyy";
  }
  // Totals exclude cancelled bookings, exactly like the page's totals row.
  const live = rows.filter((r) => r.status !== "cancelled");
  const total = (k: keyof RegisterRow) => rupees(live.reduce((s, r) => s + (r[k] as number), 0));
  const totals = sheet.addRow({
    reference: `Totals (${live.length} bookings${rows.length > live.length ? `, ${rows.length - live.length} cancelled excluded` : ""})`,
    people: live.reduce((s, r) => s + r.people, 0),
    retail: total("retail_total_cents"),
    discount: total("discount_total_cents"),
    charged: total("charged_total_cents"),
    paid: total("paid_cents"),
    balance: total("balance_cents"),
    net: total("operator_net_total_cents"),
    commission: total("commission_total_cents"),
  });
  totals.font = { bold: true };

  const byId = new Map(rows.map((r) => [r.id, r]));
  const lines = book.addWorksheet("Lines", { views: [{ state: "frozen", ySplit: 1 }] });
  lines.columns = [
    { header: "Reference", key: "reference", width: 20 },
    { header: "Service date", key: "service_date", width: 13 },
    { header: "Item", key: "item", width: 26 },
    { header: "Participant", key: "participant", width: 12 },
    { header: "Qty", key: "qty", width: 6 },
    { header: "Unit retail (Rs)", key: "retail", width: 15, style: { numFmt: MONEY } },
    { header: "Unit charged (Rs)", key: "charged", width: 16, style: { numFmt: MONEY } },
    { header: "Line total (Rs)", key: "total", width: 15, style: { numFmt: MONEY } },
    { header: "Discount (Rs)", key: "discount", width: 13, style: { numFmt: MONEY } },
    { header: "Discount reason", key: "reason", width: 24 },
    { header: "Unit operator net (Rs)", key: "net", width: 20, style: { numFmt: MONEY } },
    { header: "Commission (Rs)", key: "commission", width: 15, style: { numFmt: MONEY } },
    { header: "Commission rate", key: "rate", width: 15, style: { numFmt: "0.00%" } },
  ];
  lines.getRow(1).font = { bold: true };
  items
    .sort(
      (a, b) =>
        (byId.get(a.booking_id)?.reference ?? "").localeCompare(byId.get(b.booking_id)?.reference ?? "") ||
        a.sort_order - b.sort_order,
    )
    .forEach((i) => {
      const booking = byId.get(i.booking_id);
      lines
        .addRow({
          reference: booking?.reference,
          service_date: booking ? new Date(`${booking.service_date}T00:00:00Z`) : null,
          item: i.packages?.name ?? i.activities?.name,
          participant: i.participant_type,
          qty: i.quantity,
          retail: rupees(i.unit_retail_cents),
          charged: rupees(i.unit_charged_cents),
          total: rupees(i.unit_charged_cents * i.quantity),
          discount: rupees(i.discount_cents),
          reason: i.discount_reason,
          net: i.unit_operator_net_cents === null ? null : rupees(i.unit_operator_net_cents),
          commission: rupees(i.commission_cents),
          rate: i.commission_rate,
        })
        .getCell("service_date").numFmt = "dd mmm yyyy";
    });

  const buffer = await book.xlsx.writeBuffer();
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${fileName(f.from, f.to)}"`,
      "cache-control": "no-store",
    },
  });
}
