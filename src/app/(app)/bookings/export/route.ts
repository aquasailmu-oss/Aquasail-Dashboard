import ExcelJS from "exceljs";
import { NextResponse, type NextRequest } from "next/server";
import { authorize } from "@/lib/auth";
import { addDays, formatDateTime } from "@/lib/dates";
import { cents, fromCents } from "@/lib/money";
import { parseRegisterFilters, registerQuery, type RegisterRow } from "@/lib/register";
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
const STATUS: Record<RegisterRow["status"], string> = {
  confirmed: "Confirmed",
  completed: "Completed",
  no_show: "No-show",
  cancelled: "Cancelled",
};

/** "September_2026_Bookings_Report.xlsx" for a whole month, otherwise the exact range. */
function fileName(from: string, to: string): string {
  const wholeMonth = from.endsWith("-01") && addDays(to, 1).endsWith("-01") && from.slice(0, 7) === to.slice(0, 7);
  if (wholeMonth) return `${MONTHS[Number(from.slice(5, 7)) - 1]}_${from.slice(0, 4)}_Bookings_Report.xlsx`;
  return `Bookings_Report_${from}_to_${to}.xlsx`;
}

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

function styleSheet(sheet: ExcelJS.Worksheet) {
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.getRow(1).height = 28;
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF24327A" } };
  sheet.getRow(1).alignment = { vertical: "middle", wrapText: true };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
  sheet.pageSetup.orientation = "landscape";
  sheet.pageSetup.fitToPage = true;
  sheet.pageSetup.fitToWidth = 1;
  sheet.pageSetup.fitToHeight = 0;
  sheet.properties.defaultRowHeight = 20;
}

function addReportReadMe(book: ExcelJS.Workbook) {
  const sheet = book.addWorksheet("Read Me");
  sheet.columns = [{ width: 25 }, { width: 100 }];
  sheet.mergeCells("A1:B1");
  sheet.getCell("A1").value = "AquaSail booking report";
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

function addTotalRow(sheet: ExcelJS.Worksheet, values: ExcelJS.CellValue[]) {
  const row = sheet.addRow(values);
  row.font = { bold: true };
  row.border = { top: { style: "thin", color: { argb: "FF24327A" } } };
}

/** Date-range register export with operator workbook-style summary and detail sheets. */
export async function GET(request: NextRequest) {
  const auth = await authorize(["admin", "accountant"]);
  if (!auth.ok) return new NextResponse(auth.error, { status: 403 });

  const filters = parseRegisterFilters(Object.fromEntries(request.nextUrl.searchParams));
  const supabase = await createClient();
  const { data: rows, error } = await registerQuery(supabase, filters, "*")
    .order("service_date")
    .order("reference")
    .overrideTypes<RegisterRow[], { merge: false }>();
  if (error) return new NextResponse("The export could not be prepared. Try again.", { status: 500 });

  const settlement: SettlementRow[] = [];
  let items: ItemRow[] = [];
  let attendance: AttendanceRow[] = [];
  let participants: ParticipantRow[] = [];
  let payments: PaymentRow[] = [];
  let clientContacts: ClientContactRow[] = [];
  if (rows.length > 0) {
    const ids = rows.map((row) => row.id);
    const clientIds = [...new Set(rows.map((row) => row.client_id))];
    const [settlementResult, itemResult, attendanceResult, participantResult, paymentResult, clientResult] = await Promise.all([
      supabase
        .from("bookings")
        .select("id, tracks_settlement, agency_adjustment_status, agency_adjustment_cents, agency_adjustment_reason")
        .in("id", ids),
      supabase
        .from("booking_items")
        .select(
          "booking_id, settlement_manual, settlement_aquasail_cents, participant_type, quantity, unit_retail_cents, unit_charged_cents, unit_operator_net_cents, commission_rate, commission_cents, discount_cents, discount_reason, sort_order, packages(name), activities(name)",
        )
        .in("booking_id", ids),
      supabase
        .from("booking_attendance")
        .select(
          "booking_id, adults_expected_count, adults_present_count, children_expected_count, children_present_count, infants_expected_count, infants_present_count",
        )
        .in("booking_id", ids),
      supabase.from("booking_participants").select("booking_id, participant_type, count").in("booking_id", ids),
      supabase
        .from("payments")
        .select("booking_id, amount_cents, method, received_at, reference, note, is_correction")
        .in("booking_id", ids)
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
      return new NextResponse("The export could not be prepared. Try again.", { status: 500 });
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
  book.subject = `Filtered bookings from ${filters.from} to ${filters.to}`;
  book.calcProperties.fullCalcOnLoad = true;
  addReportReadMe(book);

  const summary = book.addWorksheet("Summary");
  summary.addRow([
    "Date",
    "Operator",
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
  styleSheet(summary);
  summary.columns = [
    { width: 15 },
    { width: 25 },
    { width: 12 },
    { width: 18 },
    { width: 18 },
    ...Array.from({ length: 8 }, () => ({ width: 23, style: { numFmt: MONEY } })),
  ];
  const daily = new Map<
    string,
    {
      date: string;
      operator: string;
      pax: number;
      present: number;
      absent: number;
      hasAttendance: boolean;
      direct: number;
      account: number;
      charged: number;
      cash: number;
      card: number;
      other: number;
      net: number;
      commission: number;
    }
  >();
  const dayKey = (date: string, operator: string) => `${date}\u0000${operator}`;
  const statsFor = (date: string, operator: string) => {
    const key = dayKey(date, operator);
    let stats = daily.get(key);
    if (!stats) {
      stats = {
        date,
        operator,
        pax: 0,
        present: 0,
        absent: 0,
        hasAttendance: false,
        direct: 0,
        account: 0,
        charged: 0,
        cash: 0,
        card: 0,
        other: 0,
        net: 0,
        commission: 0,
      };
      daily.set(key, stats);
    }
    return stats;
  };
  for (const booking of rows) {
    const operator = booking.operator_name ?? "Walk-in";
    const stats = statsFor(booking.service_date, operator);
    if (booking.status === "cancelled") continue;
    stats.pax += booking.people;
    stats.charged += booking.charged_total_cents;
    stats.net += booking.operator_net_total_cents;
    stats.commission += booking.commission_total_cents;
    if (booking.payer === "operator") stats.account += booking.charged_total_cents;
    else stats.direct += booking.charged_total_cents;
    const saved = attendanceById.get(booking.id);
    if (saved) {
      stats.hasAttendance = true;
      stats.present += saved.adults_present_count + saved.children_present_count + saved.infants_present_count;
      stats.absent +=
        saved.adults_expected_count +
        saved.children_expected_count +
        saved.infants_expected_count -
        saved.adults_present_count -
        saved.children_present_count -
        saved.infants_present_count;
    }
  }
  for (const payment of payments) {
    const booking = bookingById.get(payment.booking_id);
    if (!booking) continue;
    const stats = statsFor(booking.service_date, booking.operator_name ?? "Walk-in");
    if (payment.method === "cash") stats.cash += payment.amount_cents;
    else if (payment.method === "card") stats.card += payment.amount_cents;
    else stats.other += payment.amount_cents;
  }
  for (const stats of [...daily.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.operator.localeCompare(b.operator),
  )) {
    summary
      .addRow([
        new Date(`${stats.date}T00:00:00Z`),
        stats.operator,
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
  const live = rows.filter((row) => row.status !== "cancelled");
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const liveAttendance = attendance.filter((entry) => live.some((booking) => booking.id === entry.booking_id));
  const amountFor = (method: string) =>
    sum(payments.filter((payment) => payment.method === method).map((payment) => payment.amount_cents));
  addTotalRow(summary, [
    `Totals (${live.length} active bookings)`,
    "",
    sum(live.map((row) => row.people)),
    sum(liveAttendance.map((row) => row.adults_present_count + row.children_present_count + row.infants_present_count)),
    sum(
      liveAttendance.map(
        (row) =>
          row.adults_expected_count +
          row.children_expected_count +
          row.infants_expected_count -
          row.adults_present_count -
          row.children_present_count -
          row.infants_present_count,
      ),
    ),
    rs(sum(live.filter((row) => row.payer === "client").map((row) => row.charged_total_cents))),
    rs(sum(live.filter((row) => row.payer === "operator").map((row) => row.charged_total_cents))),
    rs(sum(live.map((row) => row.charged_total_cents))),
    rs(amountFor("cash")),
    rs(amountFor("card")),
    rs(
      sum(
        payments
          .filter((payment) => payment.method !== "cash" && payment.method !== "card")
          .map((payment) => payment.amount_cents),
      ),
    ),
    rs(sum(live.map((row) => row.operator_net_total_cents))),
    rs(sum(live.map((row) => row.commission_total_cents))),
  ]);

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
    const counts = participantsById.get(booking.id) ?? {};
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
        operator: booking.operator_name ?? "Walk-in",
        hotel: booking.hotel_name ?? "",
        client: booking.client_name,
        phone: booking.client_phone ?? "",
        email: contact?.email ?? "",
        country: contact?.country ?? "",
        items: booking.summary,
        people: booking.people,
        payer: isOperatorAccountPrebook ? "Operator account" : "Client at reception",
        status: STATUS[booking.status],
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
            : booking.operator_id && booking.status !== "cancelled"
              ? "Pending"
              : "",
      })
      .getCell("date").numFmt = "dd mmm yyyy";
  }

  const sales = book.addWorksheet("Direct Sales");
  sales.columns = [
    { header: "Date", key: "date", width: 14 },
    { header: "Operator", key: "operator", width: 24 },
    { header: "Booking", key: "reference", width: 18 },
    { header: "Client / guest on booking", key: "client", width: 28 },
    { header: "Hotel", key: "hotel", width: 22 },
    { header: "Item", key: "item", width: 26 },
    { header: "Participant", key: "participant", width: 13 },
    { header: "Qty", key: "quantity", width: 8 },
    { header: "Payer", key: "payer", width: 18 },
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
          operator: booking.operator_name ?? "Walk-in",
          reference: booking.reference,
          client: booking.client_name,
          hotel: booking.hotel_name ?? "",
          item: item.packages?.name ?? item.activities?.name ?? "",
          participant: item.participant_type,
          quantity: item.quantity,
          payer: booking.payer === "operator" ? "Operator account" : "Client at reception",
          status: STATUS[booking.status],
          retail: rs(item.unit_retail_cents * item.quantity),
          charged: rs(item.unit_charged_cents * item.quantity - item.discount_cents),
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

  const makePaymentSheet = (name: string, method: string) => {
    const sheet = book.addWorksheet(name);
    sheet.columns = [
      { header: "Received at (Mauritius time)", key: "received", width: 28 },
      { header: "Operator", key: "operator", width: 24 },
      { header: "Booking", key: "reference", width: 18 },
      { header: "Service date", key: "service_date", width: 14 },
      { header: "Client / guest on booking", key: "client", width: 28 },
      { header: "Hotel", key: "hotel", width: 22 },
      { header: "Entry", key: "entry", width: 14 },
      { header: "Amount (Rs)", key: "amount", width: 16, style: { numFmt: MONEY } },
      { header: "Reference", key: "payment_reference", width: 20 },
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
          received: formatDateTime(payment.received_at),
          operator: booking.operator_name ?? "Walk-in",
          reference: booking.reference,
          service_date: new Date(`${booking.service_date}T00:00:00Z`),
          client: booking.client_name,
          hotel: booking.hotel_name ?? "",
          entry: payment.is_correction ? "Correction" : "Payment",
          amount: rs(payment.amount_cents),
          payment_reference: payment.reference ?? "",
          note: payment.note ?? "",
        })
        .getCell("service_date").numFmt = "dd mmm yyyy";
    }
    addTotalRow(sheet, [
      "Net recorded total",
      "",
      "",
      "",
      "",
      "",
      "",
      rs(sum(matching.map((payment) => payment.amount_cents))),
      "",
      "",
    ]);
  };
  makePaymentSheet("Cash", "cash");
  makePaymentSheet("Card", "card");
  makePaymentSheet("Other Payments", "other");

  const attendanceSheet = book.addWorksheet("Attendance");
  attendanceSheet.columns = [
    { header: "Date", key: "date", width: 14 },
    { header: "Operator", key: "operator", width: 24 },
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
    const adults = counts.adult ?? 0;
    const children = counts.child ?? 0;
    const infants = counts.infant ?? 0;
    const saved = attendanceById.get(booking.id);
    const expected = saved
      ? saved.adults_expected_count + saved.children_expected_count + saved.infants_expected_count
      : adults + children + infants;
    const present = saved
      ? saved.adults_present_count + saved.children_present_count + saved.infants_present_count
      : null;
    attendanceSheet
      .addRow({
        date: new Date(`${booking.service_date}T00:00:00Z`),
        operator: booking.operator_name ?? "Walk-in",
        reference: booking.reference,
        client: booking.client_name,
        hotel: booking.hotel_name ?? "",
        adults,
        children,
        infants,
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
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${fileName(filters.from, filters.to)}"`,
      "cache-control": "no-store",
    },
  });
}
