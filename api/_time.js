/**
 * Formats a Date object into parts according to the specified timezone.
 * Returns integers for year, month, day, hour, and minute.
 */
export function getLocalDateParts(date, timezone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(date);
  const map = {};
  for (const p of parts) {
    map[p.type] = p.value;
  }
  return {
    year: parseInt(map.year, 10),
    month: parseInt(map.month, 10),
    day: parseInt(map.day, 10),
    hour: parseInt(map.hour, 10),
    minute: parseInt(map.minute, 10)
  };
}

/**
 * Returns the timezone-specific date in YYYY-MM-DD format.
 */
export function getLocalDateString(date, timezone) {
  const parts = getLocalDateParts(date, timezone);
  const mm = String(parts.month).padStart(2, '0');
  const dd = String(parts.day).padStart(2, '0');
  return `${parts.year}-${mm}-${dd}`;
}

/**
 * Subtracts 24 hours from the given YYYY-MM-DD date using UTC noon
 * to avoid daylight saving time transitions.
 */
export function getPreviousDateString(dateStr) {
  const localDateAtNoon = new Date(`${dateStr}T12:00:00Z`);
  const prevLocalDate = new Date(localDateAtNoon.getTime() - 24 * 60 * 60 * 1000);
  const prevYear = prevLocalDate.getUTCFullYear();
  const prevMonth = String(prevLocalDate.getUTCMonth() + 1).padStart(2, '0');
  const prevDay = String(prevLocalDate.getUTCDate()).padStart(2, '0');
  return `${prevYear}-${prevMonth}-${prevDay}`;
}

/**
 * Returns the day of the week (0 for Sunday, 1 for Monday, etc.)
 * for a given YYYY-MM-DD date.
 */
export function getDayOfWeek(dateStr) {
  const date = new Date(`${dateStr}T12:00:00Z`);
  return date.getUTCDay();
}
