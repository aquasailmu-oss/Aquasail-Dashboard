/**
 * Every business-facing date question is answered in Indian/Mauritius (UTC+4).
 * Timestamps are stored as timestamptz (UTC); a service date is a plain
 * "YYYY-MM-DD" string and is never timezone-shifted.
 *
 * Never use new Date().toISOString().slice(0,10) — it gives the UTC date,
 * which is yesterday in Mauritius between 00:00 and 04:00.
 */
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export const BUSINESS_TZ = "Indian/Mauritius";

/** A calendar date as "YYYY-MM-DD". */
export type IsoDate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Today's date in Mauritius. */
export function businessDate(now: Date = new Date()): IsoDate {
  return formatInTimeZone(now, BUSINESS_TZ, "yyyy-MM-dd");
}

/** Validate a "YYYY-MM-DD" input (e.g. from <input type="date">). Returns null if invalid. */
export function parseDateInput(value: string): IsoDate | null {
  const m = ISO_DATE.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d] = m.map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return value.trim();
}

function requireDate(value: IsoDate): [number, number, number] {
  const parsed = parseDateInput(value);
  if (!parsed) throw new Error(`Invalid date: "${value}"`);
  const [y, m, d] = parsed.split("-").map(Number);
  return [y, m, d];
}

/** Calendar arithmetic on plain dates (no timezone involved). */
export function addDays(value: IsoDate, days: number): IsoDate {
  const [y, m, d] = requireDate(value);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** "17 Sep 2026" from a plain date or, for a timestamp, its Mauritius date. */
export function formatDateShort(value: IsoDate | Date): string {
  const iso = value instanceof Date ? businessDate(value) : value;
  const [y, m, d] = requireDate(iso);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "Thursday 17 September 2026". */
export function formatDateLong(value: IsoDate | Date): string {
  const iso = value instanceof Date ? businessDate(value) : value;
  const [y, m, d] = requireDate(iso);
  return formatInTimeZone(new Date(Date.UTC(y, m - 1, d, 8)), BUSINESS_TZ, "EEEE d MMMM yyyy");
}

/** "08:30" from a Postgres time ("08:30:00") or a timestamp (shown in Mauritius time). */
export function formatTime(value: string | Date): string {
  if (value instanceof Date) return formatInTimeZone(value, BUSINESS_TZ, "HH:mm");
  const m = /^(\d{2}):(\d{2})/.exec(value);
  if (!m) throw new Error(`Invalid time: "${value}"`);
  return `${m[1]}:${m[2]}`;
}

/** "17 Sep 2026, 08:30" for a timestamp, in Mauritius time. */
export function formatDateTime(value: Date | string): string {
  const dt = typeof value === "string" ? new Date(value) : value;
  return `${formatDateShort(dt)}, ${formatTime(dt)}`;
}

/**
 * The instants a Mauritius business day starts and ends, as ISO timestamps,
 * for filtering timestamptz columns ("cash received today"): end is exclusive.
 */
export function businessDayBounds(value: IsoDate): { start: string; end: string } {
  requireDate(value);
  return {
    start: fromZonedTime(`${value}T00:00:00`, BUSINESS_TZ).toISOString(),
    end: fromZonedTime(`${addDays(value, 1)}T00:00:00`, BUSINESS_TZ).toISOString(),
  };
}
