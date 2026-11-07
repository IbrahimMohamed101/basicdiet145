"use strict";

// Saudi Arabia does not currently observe DST. POS business dates are always
// derived from server timestamps, never the browser's locale or timezone.
const ZONE = "Asia/Riyadh";
const DAY_MS = 24 * 60 * 60 * 1000;

function businessDateAt(instant = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(instant);
  const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return byType.year + "-" + byType.month + "-" + byType.day;
}

function boundsForBusinessDate(value) {
  if (typeof value !== "string" || !/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) {
    throw new TypeError("Invalid Asia/Riyadh businessDate");
  }
  const start = new Date(value + "T00:00:00+03:00");
  if (Number.isNaN(start.getTime()) || businessDateAt(start) !== value) {
    throw new TypeError("Invalid Asia/Riyadh businessDate");
  }
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

module.exports = { ZONE, businessDateAt, boundsForBusinessDate };
