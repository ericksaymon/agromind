export const RULE_VERSION = "inventory-5.3";
const formatters = new Map<string, Intl.DateTimeFormat>();
export function dateKey(date: Date, timezone: string) {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    formatters.set(timezone, formatter);
  }
  return formatter.format(date);
}
export const dayStamp = (day: string) =>
  Date.parse(day + "T00:00:00Z") / 86400000;
export const shiftDay = (day: string, days: number) =>
  new Date((dayStamp(day) + days) * 86400000).toISOString().slice(0, 10);
