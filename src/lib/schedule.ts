/**
 * Shared schedule vocabulary — the weekday bitmask and time formatting used by both the
 * creation form and the read-only card on Home.
 *
 * The bitmask matches the Android side exactly: bit 0 = Sunday … bit 6 = Saturday
 * (Calendar.DAY_OF_WEEK - 1). Keep the two in step.
 */

export const HOURS = Array.from({ length: 24 }, (_, h) => h);
export const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

export const DAYS = [
  { bit: 0, short: "Sun", long: "Sunday" },
  { bit: 1, short: "Mon", long: "Monday" },
  { bit: 2, short: "Tue", long: "Tuesday" },
  { bit: 3, short: "Wed", long: "Wednesday" },
  { bit: 4, short: "Thu", long: "Thursday" },
  { bit: 5, short: "Fri", long: "Friday" },
  { bit: 6, short: "Sat", long: "Saturday" },
] as const;

export const ALL_DAYS_MASK = 0b1111111;
const WEEKDAYS_MASK = 0b0111110; // Mon–Fri
const WEEKEND_MASK = 0b1000001; // Sat + Sun

export function hasDay(mask: number, bit: number): boolean {
  return (mask & (1 << bit)) !== 0;
}

export function toggleDay(mask: number, bit: number): number {
  return mask ^ (1 << bit);
}

export function formatHourLabel(hour: number): string {
  const period = hour < 12 ? "AM" : "PM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour} ${period}`;
}

export function formatTime(hour: number, minute: number): string {
  const period = hour < 12 ? "AM" : "PM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${period}`;
}

/** Human-readable day list, collapsing the common every-day / weekday / weekend cases. */
export function formatDays(mask: number): string {
  if (mask === ALL_DAYS_MASK) return "Every day";
  if (mask === WEEKDAYS_MASK) return "Weekdays (Mon–Fri)";
  if (mask === WEEKEND_MASK) return "Weekends (Sat & Sun)";
  const selected = DAYS.filter((d) => hasDay(mask, d.bit)).map((d) => d.short);
  return selected.length > 0 ? selected.join(", ") : "No days selected";
}

export function formatDate(iso: string | Date): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Display form of `active_until`. The stored instant is *exclusive* — midnight at the end
 * of the final day — so showing it raw would name the day after the one the parent picked.
 * Step back a moment to land on the last day the block actually covers.
 */
export function formatEndDate(iso: string | Date): string {
  return formatDate(new Date(new Date(iso).getTime() - 1));
}

/** True when the locked window runs past midnight into the following morning. */
export function spansMidnight(
  startHour: number,
  startMinute: number,
  endHour: number,
  endMinute: number
): boolean {
  return endHour * 60 + endMinute <= startHour * 60 + startMinute;
}

/** `YYYY-MM-DD` for a date input, in local time (not UTC — toISOString would shift it). */
export function toDateInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local midnight at the start of the given `YYYY-MM-DD`. */
export function startOfLocalDay(dateInput: string): Date {
  const [y, m, d] = dateInput.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/** Local midnight at the *end* of the given `YYYY-MM-DD` — i.e. the block runs through
 *  that whole day, so the period closes at midnight the following morning. */
export function endOfLocalDay(dateInput: string): Date {
  const start = startOfLocalDay(dateInput);
  start.setDate(start.getDate() + 1);
  return start;
}
