/** Parse --since values: "7d" (days ago) or an ISO date string. */
export function parseSince(value: string): Date {
  const daysMatch = /^(\d+(?:\.\d+)?)d$/.exec(value.trim());
  if (daysMatch) {
    return new Date(Date.now() - Number(daysMatch[1]) * 24 * 60 * 60 * 1000);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid --since value "${value}" (use e.g. 7d or 2026-08-01)`);
  }
  return date;
}
