from pathlib import Path

import xlsxwriter


OUT = Path(__file__).parent / "Aquasail_Booking_Register_Template.xlsx"
HEADERS = [
    "Booking ID",
    "Booking reference",
    "Service date",
    "Status",
    "Operator",
    "Hotel",
    "Customer",
    "Phone",
    "Email",
    "Country",
    "Items",
    "Adults",
    "Children",
    "Infants",
    "Payer",
    "Total charged (Rs)",
    "Total paid (Rs)",
    "Balance (Rs)",
    "AquaSail share (Rs)",
    "Operator share (Rs)",
]

workbook = xlsxwriter.Workbook(OUT)
bookings = workbook.add_worksheet("Bookings")
readme = workbook.add_worksheet("Read Me")

navy = "#24327A"
green = "#166534"
money_fmt = "#,##0.00;[Red](#,##0.00);-"

header = workbook.add_format(
    {
        "bold": True,
        "font_name": "Arial",
        "font_size": 10,
        "font_color": "#FFFFFF",
        "bg_color": navy,
        "align": "center",
        "valign": "vcenter",
        "text_wrap": True,
        "border": 0,
    }
)
split_header = workbook.add_format(
    {
        "bold": True,
        "font_name": "Arial",
        "font_size": 10,
        "font_color": "#FFFFFF",
        "bg_color": green,
        "align": "center",
        "valign": "vcenter",
        "text_wrap": True,
        "border": 0,
    }
)
body = workbook.add_format({"font_name": "Arial", "font_size": 10, "valign": "vcenter"})
money = workbook.add_format({"font_name": "Arial", "font_size": 10, "num_format": money_fmt})
system_money = workbook.add_format(
    {"font_name": "Arial", "font_size": 10, "num_format": money_fmt, "bg_color": "#F3F4F6"}
)
manual_money = workbook.add_format(
    {"font_name": "Arial", "font_size": 10, "num_format": money_fmt, "bg_color": "#F0FDF4"}
)

bookings.freeze_panes(1, 0)
bookings.autofilter(0, 0, 0, len(HEADERS) - 1)
bookings.set_row(0, 42)
for col, label in enumerate(HEADERS):
    bookings.write(0, col, label, split_header if col >= 18 else header)

widths = [38, 23, 15, 15, 26, 22, 28, 21, 30, 18, 46, 12, 12, 12, 22, 20, 18, 18, 22, 22]
for col, width in enumerate(widths):
    if col in (15, 16, 17):
        fmt = system_money
    elif col in (18, 19):
        fmt = manual_money
    else:
        fmt = body
    bookings.set_column(col, col, width, fmt)
bookings.set_tab_color(navy)
bookings.hide_gridlines(2)
bookings.set_landscape()
bookings.fit_to_pages(1, 0)
bookings.repeat_rows(0)

title = workbook.add_format(
    {"bold": True, "font_name": "Arial", "font_size": 16, "font_color": "#FFFFFF", "bg_color": navy, "valign": "vcenter"}
)
label_fmt = workbook.add_format(
    {"bold": True, "font_name": "Arial", "font_size": 11, "font_color": navy, "bg_color": "#E8EDF8", "text_wrap": True, "valign": "vcenter"}
)
text_fmt = workbook.add_format(
    {"font_name": "Arial", "font_size": 11, "font_color": "#1F2937", "text_wrap": True, "valign": "vcenter"}
)
readme.merge_range("A1:B1", "AquaSail booking register", title)
readme.set_row(0, 34)
instructions = [
    ("Purpose", "Upload this workbook to Google Drive, open it with Google Sheets, then save/convert it as a native Google Sheet before connecting the app."),
    ("Keep the sync layout", "Keep the tab named Bookings and preserve row 1 and columns A:T in their current order. The app uses the Booking ID in column A to find each booking."),
    ("Manual prebook split", "For Operator account rows, staff enter AquaSail share and Operator share in columns S and T. The app leaves these cells untouched on later syncs."),
    ("System-managed fields", "The app updates booking and payment details when they change. For non-prebook rows, split values are system-managed."),
    ("Template data", "No sample customer or booking data is included."),
]
for row, (label, text) in enumerate(instructions, start=2):
    readme.write(row, 0, label, label_fmt)
    readme.write(row, 1, text, text_fmt)
    readme.set_row(row, 48)
readme.set_column("A:A", 25)
readme.set_column("B:B", 105)
readme.freeze_panes(2, 0)
readme.set_tab_color("#00ADEF")
readme.hide_gridlines(2)

workbook.close()
print(OUT)
