import ExcelJS from "exceljs";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { authorize } from "@/lib/auth";
import { formatDateTime } from "@/lib/dates";
import { cents, fromCents } from "@/lib/money";
import type { RegisterRow } from "@/lib/register";
import { bookingShares } from "@/lib/settlement";
import type { Database } from "@/lib/database.types";
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
const MONEY = "#,##0.00;[Red](#,##0.00);-";
const paramsSchema = z.object({
  operator_id: z.uuid(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});

type SettlementRow = Pick<
  Database["public"]["Tables"]["bookings"]["Row"],
  "id" | "tracks_settlement" | "agency_adjustment_status" | "agency_adjustment_cents" | "agency_adjustment_reason"
>;

type ItemRow = {
  settlement_manual: boolean;
  settlement_aquasail_cents: number | null;
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

type AttendanceRow = {
  booking_id: string;
  adults_expected_count: number;
  adults_present_count: number;
  children_expected_count: number;
  children_present_count: number;
  infants_expected_count: number;
  infants_present_count: number;
};

type ParticipantRow = { booking_id: string; participant_type: string; count: number };
type PaymentRow = {
  booking_id: string;
  amount_cents: number;
  method: string;
  received_at: string;
  reference: string | null;
  note: string | null;
  is_correction: boolean;
};
type ClientContactRow = { id: string; email: string | null; country: string | null };

function styleSheet(sheet: ExcelJS.Worksheet, headerRow = 1) {
  sheet.views = [{ state: "frozen", ySplit: headerRow }];
  sheet.getRow(headerRow).height = 28;
  sheet.getRow(headerRow).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(headerRow).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF24327A" } };
  sheet.getRow(headerRow).alignment = { vertical: "middle", wrapText: true };
  if (sheet.columnCount > 0) {
    sheet.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: sheet.columnCount } };
  }
  sheet.pageSetup.orientation = "landscape";
  sheet.pageSetup.fitToPage = true;
  sheet.pageSetup.fitToWidth = 1;
  sheet.pageSetup.fitToHeight = 0;
  sheet.properties.defaultRowHeight = 20;
}

function addTotalRow(sheet: ExcelJS.Worksheet, label: string, values: (number | string | null)[]) {
  const row = sheet.addRow([label, ...values]);
  row.font = { bold: true };
  row.border = { top: { style: "thin", color: { argb: "FF24327A" } } };
  return row;
}

function addReportReadMe(book: ExcelJS.Workbook) {
  const sheet = book.addWorksheet("Read Me");
  sheet.columns = [{ width: 25 }, { width: 100 }];
  sheet.mergeCells("A1:B1");
  sheet.getCell("A1").value = "AquaSail monthly operator report";
  sheet.getCell("A1").font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF24327A" } };
  sheet.getRow(1).height = 32;
  sheet.addRow([
    "Purpose",
    "This file is a reporting snapshot. Do not upload it as the live Google Sheets Booking Register.",
  ]);
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
  sheet.addRow([
    "Live Booking Register",
    spreadsheetId
      ? {
          text: "Open the live register",
          hyperlink: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
        }
      : "Not configured for this environment.",
  ]);
  sheet.addRow([
    "Pre-book splits",
    "For operator-account prebooks, enter the shares in the live register after the booking is paid in full.",
  ]);
  for (const rowNumber of [2, 3, 4]) {
    const row = sheet.getRow(rowNumber);
    row.height = 36;
    row.alignment = { vertical: "top", wrapText: true };
    row.getCell(1).font = { bold: true, color: { argb: "FF24327A" } };
  }
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

function rs(amountCents: number): number {
  return fromCents(cents(amountCents));
}

/** Monthly operator workbook based only on the booking, payment and attendance data the app stores today. */
export async function GET(request: NextRequest) {
  const auth = await authorize(["admin", "accountant"]);
  if (!auth.ok) return new NextResponse(auth.error, { status: 403 });

  const parsed = paramsSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return new NextResponse("Choose a valid operator and service month.", { status: 400 });
  const { operator_id: operatorId, month } = parsed.data;
  const from = `${month}-01`;
  const [year, monthNumber] = month.split("-").map(Number);
  const to = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);

  const supabase = await createClient();
  const [{ data: operator, error: operatorError }, { data: rows, error: bookingError }] = await Promise.all([
    supabase.from("tour_operators").select("id, name").eq("id", operatorId).maybeSingle(),
    supabase
      .from("booking_register")
      .select("*")
      .eq("operator_id", operatorId)
      .gte("service_date", from)
      .lte("service_date", to)
      .order("service_date")
      .order("reference")
      .overrideTypes<RegisterRow[], { merge: false }>(),
  ]);
  if (operatorError || bookingError)
    return new NextResponse("The operator workbook could not be prepared. Try again.", { status: 500 });
  if (!operator) return new NextResponse("That operator could not be found.", { status: 404 });

  const bookingIds = rows.map((row) => row.id);
  const settlement: SettlementRow[] = [];
  let items: ItemRow[] = [];
  let attendance: AttendanceRow[] = [];
  let participants: ParticipantRow[] = [];
  let payments: PaymentRow[] = [];
  let clientContacts: ClientContactRow[] = [];
  if (bookingIds.length > 0) {
    const clientIds = [...new Set(rows.map((row) => row.client_id))];
    const [settlementResult, itemResult, attendanceResult, participantResult, paymentResult, clientResult] = await Promise.all([
      supabase
        .from("bookings")
        .select("id, tracks_settlement, agency_adjustment_status, agency_adjustment_cents, agency_adjustment_reason")
        .in("id", bookingIds),
      supabase
        .from("booking_items")
        .select(
          "booking_id, settlement_manual, settlement_aquasail_cents, participant_type, quantity, unit_retail_cents, unit_charged_cents, unit_operator_net_cents, commission_rate, commission_cents, discount_cents, discount_reason, sort_order, packages(name), activities(name)",
        )
        .in("booking_id", bookingIds),
      supabase
        .from("booking_attendance")
        .select(
          "booking_id, adults_expected_count, adults_present_count, children_expected_count, children_present_count, infants_expected_count, infants_present_count",
        )
        .in("booking_id", bookingIds),
      supabase.from("booking_participants").select("booking_id, participant_type, count").in("booking_id", bookingIds),
      supabase
        .from("payments")
        .select("booking_id, amount_cents, method, received_at, reference, note, is_correction")
        .in("booking_id", bookingIds)
        .order("received_at"),
      supabase.from("clients").select("id, email, country").in("id", clientIds).overrideTypes<ClientContactRow[], { merge: false }>(),
    ]);
    if (
      itemResult.error ||
      attendanceResult.error ||
      participantResult.error ||
      paymentResult.error ||
      settlementResult.error ||
      clientResult.error
    ) {
      return new NextResponse("The operator workbook could not be prepared. Try again.", { status: 500 });
    }
    settlement.push(...settlementResult.data);
    items = itemResult.data;
    attendance = attendanceResult.data;
    participants = participantResult.data;
    payments = paymentResult.data;
    clientContacts = clientResult.data;
  }

  const settlementById = new Map(settlement.map((row) => [row.id, row]));
  const bookingById = new Map(rows.map((row) => [row.id, row]));
  const attendanceById = new Map(attendance.map((row) => [row.booking_id, row]));
  const participantsById = new Map<string, Record<string, number>>();
  const itemsByBooking = new Map<string, ItemRow[]>();
  const contactsById = new Map(clientContacts.map((client) => [client.id, client]));
  for (const item of items) itemsByBooking.set(item.booking_id, [...(itemsByBooking.get(item.booking_id) ?? []), item]);
  for (const participant of participants) {
    const counts = participantsById.get(participant.booking_id) ?? {};
    counts[participant.participant_type] = participant.count;
    participantsById.set(participant.booking_id, counts);
  }

  const book = new ExcelJS.Workbook();
  book.creator = "AquaSail Ops";
  book.subject = `${operator.name} monthly booking and payment export`;
  book.title = `${operator.name} · ${MONTHS[monthNumber - 1]} ${year}`;
  book.company = "AquaSail Ops";
  book.calcProperties.fullCalcOnLoad = true;
  addReportReadMe(book);

  const summary = book.addWorksheet("Monthly Summary");
  summary.mergeCells("A1:L1");
  summary.getCell("A1").value = `${operator.name} · ${MONTHS[monthNumber - 1]} ${year}`;
  summary.getCell("A1").font = { bold: true, size: 16, color: { argb: "FF24327A" } };
  summary.mergeCells("A2:L2");
  summary.getCell("A2").value =
    "System-recorded booking, payment and attendance totals. Operator net and commission are exported as saved by the app.";
  summary.getCell("A2").font = { italic: true, color: { argb: "FF555555" } };
  summary.mergeCells("A3:L3");
  summary.getCell("A3").value =
    "The app currently records attendance as counts, not named passengers or no-activity flags. Cash is shown in the app's current payment format.";
  summary.getCell("A3").font = { italic: true, color: { argb: "FF555555" } };
  summary.addRow([]);
  summary.addRow([
    "Date",
    "PAX booked",
    "Present (recorded)",
    "Absent (recorded)",
    "Direct / client-payer sales (Rs)",
    "Pre-book / operator-account sales (Rs)",
    "Total charged (Rs)",
    "Cash recorded (Rs)",
    "Card recorded (Rs)",
    "Other payments (Rs)",
    "Operator net (system) (Rs)",
    "Commission (system) (Rs)",
  ]);
  styleSheet(summary, 5);
  const daily = new Map<
    string,
    {
      pax: number;
      present: number;
      absent: number;
      hasAttendance: boolean;
      direct: number;
      account: number;
      charged: number;
      net: number;
      commission: number;
      cash: number;
      card: number;
      other: number;
    }
  >();
  const statsFor = (date: string) => {
    let stats = daily.get(date);
    if (!stats) {
      stats = {
        pax: 0,
        present: 0,
        absent: 0,
        hasAttendance: false,
        direct: 0,
        account: 0,
        charged: 0,
        net: 0,
        commission: 0,
        cash: 0,
        card: 0,
        other: 0,
      };
      daily.set(date, stats);
    }
    return stats;
  };
  for (const row of rows) {
    const stats = statsFor(row.service_date);
    const attendee = attendanceById.get(row.id);
    if (row.status !== "cancelled") {
      stats.pax += row.people;
      stats.charged += row.charged_total_cents;
      stats.net += row.operator_net_total_cents;
      stats.commission += row.commission_total_cents;
      if (row.payer === "operator") stats.account += row.charged_total_cents;
      else stats.direct += row.charged_total_cents;
      if (attendee) {
        stats.hasAttendance = true;
        stats.present +=
          attendee.adults_present_count + attendee.children_present_count + attendee.infants_present_count;
        stats.absent +=
          attendee.adults_expected_count +
          attendee.children_expected_count +
          attendee.infants_expected_count -
          attendee.adults_present_count -
          attendee.children_present_count -
          attendee.infants_present_count;
      }
    }
  }
  for (const payment of payments) {
    const booking = bookingById.get(payment.booking_id);
    if (!booking) continue;
    const stats = statsFor(booking.service_date);
    if (payment.method === "cash") stats.cash += payment.amount_cents;
    else if (payment.method === "card") stats.card += payment.amount_cents;
    else stats.other += payment.amount_cents;
  }
  for (const [date, stats] of [...daily].sort(([a], [b]) => a.localeCompare(b))) {
    summary
      .addRow([
        new Date(`${date}T00:00:00Z`),
        stats.pax,
        stats.hasAttendance ? stats.present : null,
        stats.hasAttendance ? stats.absent : null,
        rs(stats.direct),
        rs(stats.account),
        rs(stats.charged),
        rs(stats.cash),
        rs(stats.card),
        rs(stats.other),
        rs(stats.net),
        rs(stats.commission),
      ])
      .getCell(1).numFmt = "dd mmm yyyy";
  }
  const liveRows = rows.filter((row) => row.status !== "cancelled");
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const recordedAttendance = attendance.filter((row) => liveRows.some((booking) => booking.id === row.booking_id));
  const paymentForMethod = (method: string) =>
    sum(payments.filter((payment) => payment.method === method).map((payment) => payment.amount_cents));
  const totalRow = summary.addRow([
    `Totals (${liveRows.length} active bookings)`,
    sum(liveRows.map((row) => row.people)),
    sum(
      recordedAttendance.map(
        (row) => row.adults_present_count + row.children_present_count + row.infants_present_count,
      ),
    ),
    sum(
      recordedAttendance.map(
        (row) =>
          row.adults_expected_count +
          row.children_expected_count +
          row.infants_expected_count -
          row.adults_present_count -
          row.children_present_count -
          row.infants_present_count,
      ),
    ),
    rs(sum(liveRows.filter((row) => row.payer === "client").map((row) => row.charged_total_cents))),
    rs(sum(liveRows.filter((row) => row.payer === "operator").map((row) => row.charged_total_cents))),
    rs(sum(liveRows.map((row) => row.charged_total_cents))),
    rs(paymentForMethod("cash")),
    rs(paymentForMethod("card")),
    rs(
      sum(
        payments
          .filter((payment) => payment.method !== "cash" && payment.method !== "card")
          .map((payment) => payment.amount_cents),
      ),
    ),
    rs(sum(liveRows.map((row) => row.operator_net_total_cents))),
    rs(sum(liveRows.map((row) => row.commission_total_cents))),
  ]);
  totalRow.font = { bold: true };
  totalRow.border = { top: { style: "thin", color: { argb: "FF24327A" } } };
  summary.columns = [
    { width: 16 },
    { width: 12 },
    { width: 19 },
    { width: 19 },
    ...Array.from({ length: 8 }, () => ({ width: 22, style: { numFmt: MONEY } })),
  ];
  summary.getColumn(1).numFmt = "dd mmm yyyy";

  const statusLabel: Record<RegisterRow["status"], string> = {
    confirmed: "Confirmed",
    completed: "Completed",
    no_show: "No-show",
    cancelled: "Cancelled",
  };
  const bookingSheet = book.addWorksheet("Booking Register");
  bookingSheet.columns = [
    { header: "Service date", key: "date", width: 15 },
    { header: "Booking", key: "reference", width: 20 },
    { header: "Operator", key: "operator", width: 24 },
    { header: "Hotel", key: "hotel", width: 22 },
    { header: "Customer", key: "client", width: 28 },
    { header: "Phone", key: "phone", width: 20 },
    { header: "Email", key: "email", width: 28 },
    { header: "Country", key: "country", width: 18 },
    { header: "Items", key: "items", width: 38 },
    { header: "Guests", key: "people", width: 10 },
    { header: "Payer", key: "payer", width: 19 },
    { header: "Status", key: "status", width: 14 },
    { header: "Total charged (Rs)", key: "charged", width: 20, style: { numFmt: MONEY } },
    { header: "Total paid (Rs)", key: "paid", width: 18, style: { numFmt: MONEY } },
    { header: "Balance (Rs)", key: "balance", width: 18, style: { numFmt: MONEY } },
    { header: "AquaSail share (Rs)", key: "aquasail", width: 22, style: { numFmt: MONEY } },
    { header: "Operator share (Rs)", key: "operator_share", width: 22, style: { numFmt: MONEY } },
    { header: "Split status", key: "split_status", width: 20 },
  ];
  styleSheet(bookingSheet);
  for (const booking of rows) {
    const itemRows = itemsByBooking.get(booking.id) ?? [];
    const isOperatorAccountPrebook = booking.payer === "operator";
    let aquasail = 0;
    let operatorShare = 0;
    let splitComplete = Boolean(settlementById.get(booking.id)?.tracks_settlement) && booking.status !== "cancelled";
    let hasManualSplit = false;
    if (!isOperatorAccountPrebook && splitComplete) {
      for (const item of itemRows) {
        hasManualSplit ||= item.settlement_manual;
        const shares = bookingShares(
          item.unit_charged_cents * item.quantity - item.discount_cents,
          item.settlement_manual,
          item.settlement_aquasail_cents,
        );
        if (shares.aquasail === null || shares.operator === null) {
          splitComplete = false;
          break;
        }
        aquasail += shares.aquasail;
        operatorShare += shares.operator;
      }
    } else {
      splitComplete = false;
    }
    const contact = contactsById.get(booking.client_id);
    bookingSheet
      .addRow({
        date: new Date(`${booking.service_date}T00:00:00Z`),
        reference: booking.reference,
        operator: booking.operator_name ?? operator.name,
        hotel: booking.hotel_name ?? "",
        client: booking.client_name,
        phone: booking.client_phone ?? "",
        email: contact?.email ?? "",
        country: contact?.country ?? "",
        items: booking.summary,
        people: booking.people,
        payer: isOperatorAccountPrebook ? "Operator account" : "Client at reception",
        status: statusLabel[booking.status],
        charged: rs(booking.charged_total_cents),
        paid: rs(booking.paid_cents),
        balance: rs(booking.balance_cents),
        aquasail: !isOperatorAccountPrebook && splitComplete ? rs(aquasail) : null,
        operator_share: !isOperatorAccountPrebook && splitComplete ? rs(operatorShare) : null,
        split_status: isOperatorAccountPrebook
          ? "Manual entry"
          : splitComplete
            ? hasManualSplit
              ? "Manual"
              : "Standard 50/50"
            : booking.status !== "cancelled"
              ? "Pending"
              : "",
      })
      .getCell("date").numFmt = "dd mmm yyyy";
  }

  const sales = book.addWorksheet("Direct Sales");
  sales.columns = [
    { header: "Date", key: "date", width: 14 },
    { header: "Booking", key: "reference", width: 18 },
    { header: "Client / guest on booking", key: "client", width: 28 },
    { header: "Hotel", key: "hotel", width: 22 },
    { header: "Item", key: "item", width: 25 },
    { header: "Participant", key: "participant", width: 13 },
    { header: "Qty", key: "quantity", width: 8 },
    { header: "Payer", key: "payer", width: 16 },
    { header: "Status", key: "status", width: 14 },
    { header: "Retail snapshot (Rs)", key: "retail", width: 19, style: { numFmt: MONEY } },
    { header: "Charged line (Rs)", key: "charged", width: 19, style: { numFmt: MONEY } },
    { header: "Discount (Rs)", key: "discount", width: 16, style: { numFmt: MONEY } },
    { header: "Operator net recorded (Rs)", key: "net", width: 24, style: { numFmt: MONEY } },
    { header: "Commission recorded (Rs)", key: "commission", width: 24, style: { numFmt: MONEY } },
    { header: "AquaSail share (Rs)", key: "aquasail_share", width: 22, style: { numFmt: MONEY } },
    { header: "Operator share (Rs)", key: "operator_share", width: 22, style: { numFmt: MONEY } },
    { header: "Split status", key: "split_status", width: 20 },
  ];
  styleSheet(sales);
  const itemTotal = (item: ItemRow, field: "retail" | "charged") => {
    const unit = field === "retail" ? item.unit_retail_cents : item.unit_charged_cents;
    return unit * item.quantity - (field === "charged" ? item.discount_cents : 0);
  };
  items
    .sort(
      (a, b) =>
        (bookingById.get(a.booking_id)?.service_date ?? "").localeCompare(
          bookingById.get(b.booking_id)?.service_date ?? "",
        ) ||
        (bookingById.get(a.booking_id)?.reference ?? "").localeCompare(
          bookingById.get(b.booking_id)?.reference ?? "",
        ) ||
        a.sort_order - b.sort_order,
    )
    .forEach((item) => {
      const booking = bookingById.get(item.booking_id);
      if (!booking) return;
      const isOperatorAccountPrebook = booking.payer === "operator";
      const shares =
        !isOperatorAccountPrebook &&
        booking.operator_id && booking.status !== "cancelled" && settlementById.get(booking.id)?.tracks_settlement
          ? bookingShares(
              item.unit_charged_cents * item.quantity - item.discount_cents,
              item.settlement_manual,
              item.settlement_aquasail_cents,
            )
          : null;
      sales
        .addRow({
          date: new Date(`${booking.service_date}T00:00:00Z`),
          reference: booking.reference,
          client: booking.client_name,
          hotel: booking.hotel_name ?? "",
          item: item.packages?.name ?? item.activities?.name ?? "",
          participant: item.participant_type,
          quantity: item.quantity,
          payer: booking.payer === "operator" ? "Operator account" : "Client at reception",
          status: statusLabel[booking.status],
          retail: rs(itemTotal(item, "retail")),
          charged: rs(itemTotal(item, "charged")),
          discount: rs(item.discount_cents),
          net: item.unit_operator_net_cents === null ? null : rs(item.unit_operator_net_cents * item.quantity),
          commission: rs(item.commission_cents),
          aquasail_share: shares?.aquasail != null ? rs(shares.aquasail) : null,
          operator_share: shares?.operator != null ? rs(shares.operator) : null,
          split_status: isOperatorAccountPrebook
            ? "Manual entry"
            : shares
            ? shares.aquasail === null
              ? "Pending"
              : item.settlement_manual
                ? "Manual"
                : "Standard 50/50"
            : null,
        })
        .getCell("date").numFmt = "dd mmm yyyy";
    });

  const paymentLabel = (payment: PaymentRow) => (payment.is_correction ? "Correction" : "Payment");
  const makePaymentSheet = (name: string, method: string) => {
    const sheet = book.addWorksheet(name);
    sheet.columns = [
      { header: "Received at (Mauritius time)", key: "received_at", width: 27 },
      { header: "Booking", key: "reference", width: 18 },
      { header: "Service date", key: "service_date", width: 14 },
      { header: "Client / guest on booking", key: "client", width: 28 },
      { header: "Hotel", key: "hotel", width: 22 },
      { header: "Entry", key: "entry", width: 14 },
      { header: "Amount (Rs)", key: "amount", width: 16, style: { numFmt: MONEY } },
      { header: "Reference", key: "reference_text", width: 20 },
      { header: "Note", key: "note", width: 32 },
    ];
    styleSheet(sheet);
    const matching = payments.filter((payment) =>
      method === "other" ? payment.method !== "cash" && payment.method !== "card" : payment.method === method,
    );
    for (const payment of matching) {
      const booking = bookingById.get(payment.booking_id);
      if (!booking) continue;
      sheet
        .addRow({
          received_at: formatDateTime(payment.received_at),
          reference: booking.reference,
          service_date: new Date(`${booking.service_date}T00:00:00Z`),
          client: booking.client_name,
          hotel: booking.hotel_name ?? "",
          entry: paymentLabel(payment),
          amount: rs(payment.amount_cents),
          reference_text: payment.reference ?? "",
          note: payment.note ?? "",
        })
        .getCell("service_date").numFmt = "dd mmm yyyy";
    }
    addTotalRow(sheet, "Net recorded total", [
      null,
      null,
      null,
      null,
      null,
      rs(sum(matching.map((payment) => payment.amount_cents))),
      null,
      null,
    ]);
    return sheet;
  };
  makePaymentSheet("Cash", "cash");
  makePaymentSheet("Card", "card");
  makePaymentSheet("Other Payments", "other");

  const attendanceSheet = book.addWorksheet("Attendance");
  attendanceSheet.columns = [
    { header: "Date", key: "date", width: 14 },
    { header: "Booking", key: "reference", width: 18 },
    { header: "Client / guest on booking", key: "client", width: 28 },
    { header: "Hotel", key: "hotel", width: 22 },
    { header: "Adults booked", key: "adults", width: 14 },
    { header: "Children booked", key: "children", width: 16 },
    { header: "Infants booked", key: "infants", width: 15 },
    { header: "Total booked", key: "expected", width: 14 },
    { header: "Present (recorded)", key: "present", width: 19 },
    { header: "Absent (recorded)", key: "absent", width: 19 },
    { header: "Attendance status", key: "recorded", width: 20 },
  ];
  styleSheet(attendanceSheet);
  for (const booking of rows) {
    const counts = participantsById.get(booking.id) ?? {};
    const adult = counts.adult ?? 0;
    const child = counts.child ?? 0;
    const infant = counts.infant ?? 0;
    const saved = attendanceById.get(booking.id);
    const expected = saved
      ? saved.adults_expected_count + saved.children_expected_count + saved.infants_expected_count
      : adult + child + infant;
    const present = saved
      ? saved.adults_present_count + saved.children_present_count + saved.infants_present_count
      : null;
    attendanceSheet
      .addRow({
        date: new Date(`${booking.service_date}T00:00:00Z`),
        reference: booking.reference,
        client: booking.client_name,
        hotel: booking.hotel_name ?? "",
        adults: adult,
        children: child,
        infants: infant,
        expected,
        present,
        absent: saved ? expected - present! : null,
        recorded: saved ? "Recorded" : "Not recorded",
      })
      .getCell("date").numFmt = "dd mmm yyyy";
  }

  const adjustments = book.addWorksheet("Pre-book Adjustments");
  adjustments.columns = [
    { header: "Service date", width: 16, style: { numFmt: "dd mmm yyyy" } },
    { header: "Booking", width: 22 },
    { header: "Operator", width: 26 },
    { header: "Adjustment status", width: 22 },
    { header: "Change to amount owed (Rs)", width: 26, style: { numFmt: MONEY } },
    { header: "Reason", width: 38 },
  ];
  styleSheet(adjustments);
  let adjustmentTotal = 0;
  let pendingAdjustments = 0;
  for (const booking of rows) {
    const entry = settlementById.get(booking.id);
    if (
      booking.payer !== "operator" ||
      booking.status === "cancelled" ||
      !entry ||
      entry.agency_adjustment_status === "none"
    )
      continue;
    adjustmentTotal += entry.agency_adjustment_cents ?? 0;
    if (entry.agency_adjustment_status === "pending") pendingAdjustments++;
    adjustments.addRow([
      new Date(booking.service_date + "T00:00:00Z"),
      booking.reference,
      booking.operator_name,
      entry.agency_adjustment_status === "pending" ? "Pending" : "Recorded",
      entry.agency_adjustment_cents === null ? null : rs(entry.agency_adjustment_cents),
      entry.agency_adjustment_reason,
    ]);
  }
  adjustments.addRow(["Total recorded", null, null, pendingAdjustments + " pending", rs(adjustmentTotal)]).font = {
    bold: true,
  };

  const buffer = await book.xlsx.writeBuffer();
  const filename = `${operator.name.replace(/[^A-Za-z0-9_-]+/g, "_")}_${MONTHS[monthNumber - 1]}_${year}_Report.xlsx`;
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
