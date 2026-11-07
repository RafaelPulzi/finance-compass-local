import type { ISODate } from "./types";

/**
 * Calendar dates, kept as ISO "YYYY-MM-DD" strings with no time and no zone.
 *
 * A Transaction happens on a day, not at an instant, so nothing here ever goes
 * through UTC. That matters in Brazil: `new Date().toISOString()` is already
 * tomorrow from 21:00 in São Paulo (UTC-3), which would date an evening's
 * spending on the wrong day and flip the dashboard into next month early.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Whether `value` is a real calendar date in ISO form. "2026-02-31" has the
 * right shape and is still not a day that exists, so the shape alone is not
 * enough — the date is rebuilt and has to come back unchanged.
 */
export function isValidISODate(value: string): value is ISODate {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
  );
}

/** The local calendar day `date` falls on, as "YYYY-MM-DD". */
export function toLocalISODate(date: Date): ISODate {
  const y = String(date.getFullYear()).padStart(4, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Today on the user's own calendar. */
export function localTodayISO(now: Date = new Date()): ISODate {
  return toLocalISODate(now);
}

/** "2026-10-07" -> "07/10/2026", the way dates are read in Brazil. */
export function formatDateBR(date: ISODate): string {
  const match = ISO_DATE.exec(date);
  if (!match) return date;
  return `${match[3]}/${match[2]}/${match[1]}`;
}
