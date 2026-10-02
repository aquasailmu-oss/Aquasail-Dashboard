# Island Staff User Guide

This guide is for island staff (`activity_staff`) and supervisors (`activity_supervisor`)
using the AquaSail scan app on a tablet at Ile aux Cerfs.

---

## Getting started

### Device registration (supervisor only)

1. Sign in on the tablet with your supervisor account.
2. The app shows "This device is not registered yet." Tap **REGISTER DEVICE**.
3. Enter a name the team will recognise ("Island tablet 1") and select the location.
4. Tap **REGISTER DEVICE**. The status bar now shows the device name, location and
   your name.

Once registered, the device stays registered across sign-outs. Staff sign in on
top of it.

### Signing in as staff

1. Open the app on a registered tablet.
2. Sign in with your staff account. You land on the scan screen.
3. The status bar shows your name, the device label and the location.

---

## Scanning a ticket

Point the camera at the QR code on the customer's phone or printed ticket.
The app reads the code automatically.

### If the camera will not read the code

Tap **ENTER REFERENCE**. Type the digits from the booking reference printed below
the QR code (for example, type `0042` for WS-20261002-0042). Tap **CHECK TICKET**.
This does exactly the same thing as scanning.

---

## Verdict screens

After a scan, the screen fills with a colour and a verdict. The colour is the
message: readable at arm's length in direct sun.

| Colour | Verdict | What to do |
|--------|---------|------------|
| Green | **VALID** | Check the party in, then redeem what they take. |
| Green | **PARTLY USED** | Some entitlements already redeemed. Redeem the rest. Screen shows when, who and where the first ones went. |
| Amber | **ALREADY REDEEMED** | Everything on this ticket has been used. Screen shows when, by whom and at which location. No call needed. |
| Amber | **WRONG DATE** | The ticket is for a different date (shown on screen). Send them to reception. |
| Red | **CANCELLED** | Do not serve. Call reception. Do not explain the reason yourself. |
| Red | **REVOKED** | A newer ticket was issued for this booking. Ask the customer to check for a later message. |
| Red | **NOT FOUND** | Try typing the reference first. Most of these are bad scans in direct sun. |
| Blue | **CANNOT VERIFY OFFLINE** | The device is offline and this ticket is not in today's manifest. Wait and retry if you can. If the customer is waiting, use PROVISIONAL (see below). |

After every verdict, tap **SCAN NEXT** to return to the camera.

---

## Check-in

On a **VALID** or **PARTLY USED** verdict:

1. Tap the **CHECK IN** button (shows the party size, e.g. "CHECK IN · 4 people").
2. The screen confirms with the time and your name.

If the party was already checked in, the original time is shown. A second scan
does not reset it.

---

## Redeeming entitlements

Below the check-in area, each activity the booking includes is listed with its
entitled quantity and how many remain.

1. The **REDEEM** button defaults to the full remaining amount.
2. To redeem fewer (for example, 3 of 4 lunches now, 1 later), tap the minus
   stepper to adjust the quantity, then tap **REDEEM 3**.
3. After redeeming, the row updates instantly showing how many are left.

### Undo (within 30 seconds)

An **UNDO** button appears on the row for 30 seconds after redeeming. Tap it to
reverse the redemption immediately. After 30 seconds, only a supervisor can
reverse it.

### Activities marked NOT INCLUDED

Grey rows marked **NOT INCLUDED** are activities the booking does not cover. If a
customer asks "is parasailing included?", this gives you the answer without
calling reception.

---

## Working offline

The app works without connectivity. Redemptions and check-ins are queued locally
and sync when the connection returns.

### Status bar indicators

- **Synced 08:12 · 2 hours ago**: the manifest was last refreshed at 08:12. If
  the age turns amber (past 3 hours), the data may be stale.
- **Queue: 3**: three events are waiting to sync. They will post automatically
  when connectivity returns.

### What to do when the device says offline

- Keep working. The queue holds everything.
- Tap the sync button when you are back on wifi to push the queue immediately.
- At the end of the shift, check that the queue is at zero before handing over.

### Provisional redemptions

If a scanned ticket is not in the offline manifest (blue CANNOT VERIFY OFFLINE
screen), you have two choices:

1. **Wait and retry** — if connectivity is intermittent.
2. **Record a provisional redemption** — type the booking reference manually. The
   redemption is flagged for supervisor review. Use this when a customer is
   standing in front of you and waiting.

---

## Supervisor tools

Supervisors see a **Supervisor** link in the header. Tap it to access:

### Review queue

Lists flagged redemptions (over-redemptions and provisionals). For each item:

- **ACCEPT**: the party genuinely received more than entitled (chase it or write it off).
- **REVERSE**: it was a mis-scan; the redemption is undone. Both require a note.

Items older than 48 hours are highlighted.

### Device management

Lists all registered devices. Tap **Deactivate** on a lost or stolen device to
stop it working immediately. A deactivated device cannot redeem anything, even
if someone is still signed in on it.

### Shift handover

Shows the current shift's numbers: check-ins, redemptions by activity, and
flagged items. Show this to the next shift at changeover.

---

## Who to call

| Situation | Contact |
|-----------|---------|
| Customer says their booking is wrong | Reception |
| Camera will not read any code | Type the reference. If that fails too, call reception for the booking reference. |
| Device says offline all day | Check the queue depth in the status bar. Sync at reception at end of shift. Review anything flagged. |
| Two staff redeemed the same lunch | It will appear in the supervisor review queue. Accept or reverse with a note. |
| Device lost or stolen | Supervisor: deactivate it immediately in Device Management. It holds no tokens, no prices, only surnames and lunch counts. |
| Customer says they never got their ticket | Check the delivery history on the booking (reception). Resend or print. |
