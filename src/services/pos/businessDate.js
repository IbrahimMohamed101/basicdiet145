"use strict";

// Saudi Arabia does not observe DST. Financial business dates use Riyadh
// server instants and an optional HH:mm rollover, never client-provided dates.
const ZONE = "Asia/Riyadh";
const DAY_MS = 24 * 60 * 60 * 1000;
const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;

function parseBusinessDayCutoff(value = "00:00") {
  const raw = value === undefined || value === null ? "00:00" : value;
  if (typeof raw !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) {
    throw new TypeError("Invalid businessDayCutoff (expected HH:mm Asia/Riyadh)");
  }
  return raw;
}
function cutoffMs(cutoff = "00:00") {
  const [hh, mm] = parseBusinessDayCutoff(cutoff).split(":").map(Number);
  return (hh * 60 + mm) * 60 * 1000;
}
function businessDateAt(instant = new Date(), cutoff = "00:00") {
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    throw new TypeError("Invalid payment/receipt instant");
  }
  return new Date(instant.getTime() + RIYADH_OFFSET_MS - cutoffMs(cutoff))
    .toISOString().slice(0, 10);
}
function boundsForBusinessDate(value, cutoff = "00:00") {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError("Invalid Asia/Riyadh businessDate");
  }
  const start = new Date(value + "T00:00:00+03:00");
  if (Number.isNaN(start.getTime()) || new Date(start.getTime() + RIYADH_OFFSET_MS).toISOString().slice(0, 10) !== value) {
    throw new TypeError("Invalid Asia/Riyadh businessDate");
  }
  const adjusted = new Date(start.getTime() + cutoffMs(cutoff));
  return { start: adjusted, end: new Date(adjusted.getTime() + DAY_MS) };
}
module.exports = { ZONE, businessDateAt, boundsForBusinessDate, parseBusinessDayCutoff };
