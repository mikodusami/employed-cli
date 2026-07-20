/** Formats timestamps compactly for terminal reports. */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

/** Converts an ISO timestamp into a compact relative label such as `2d ago`. */
export function relativeTime(value: string | Date, now = new Date()): string {
  const date = value instanceof Date ? value : parseTimestamp(value);
  if (Number.isNaN(date.getTime())) {
    return 'unknown';
  }

  const differenceMs = now.getTime() - date.getTime();
  const absoluteMs = Math.abs(differenceMs);
  if (absoluteMs < MINUTE_MS) {
    return 'just now';
  }

  const units: ReadonlyArray<readonly [number, string]> = [
    [YEAR_MS, 'y'],
    [MONTH_MS, 'mo'],
    [DAY_MS, 'd'],
    [HOUR_MS, 'h'],
    [MINUTE_MS, 'm'],
  ];
  const [unitMs, suffix] = units.find(([milliseconds]) => absoluteMs >= milliseconds) ?? [
    MINUTE_MS,
    'm',
  ];
  const amount = Math.floor(absoluteMs / unitMs);
  return differenceMs >= 0 ? `${amount}${suffix} ago` : `in ${amount}${suffix}`;
}

function parseTimestamp(value: string): Date {
  const sqliteUtcPattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
  return new Date(sqliteUtcPattern.test(value) ? `${value.replace(' ', 'T')}Z` : value);
}
