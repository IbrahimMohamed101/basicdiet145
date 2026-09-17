"use strict";

const SubscriptionDay = require("../models/SubscriptionDay");
const SubscriptionPickupRequest = require("../models/SubscriptionPickupRequest");

const QUERY_PATCHED = Symbol.for("basicdiet.pickupCanonical.queryPatched");
const QUERY_EXEC_PATCHED = Symbol.for("basicdiet.pickupCanonical.safeExecPatched");
const SAFE_QUERY_INSTALLED = Symbol.for("basicdiet.pickupCanonical.safeQueryInstalled");
const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;

function clean(value) {
  if (value === undefined || value === null) return "";
  try {
    return String(value).trim();
  } catch (_err) {
    return "";
  }
}

function safeAsId(value) {
  if (value === undefined || value === null || value === "") return null;

  if (value && typeof value === "object") {
    if (typeof value.toHexString === "function") {
      try {
        const hex = clean(value.toHexString());
        if (hex) return hex;
      } catch (_err) {
        // Fall through to nested-id/string handling.
      }
    }

    let nestedId;
    try {
      nestedId = value._id;
    } catch (_err) {
      nestedId = null;
    }
    if (nestedId !== undefined && nestedId !== null && nestedId !== value) {
      return safeAsId(nestedId);
    }
  }

  const text = clean(value);
  return text || null;
}

async function attachSourceDaysSafe(result) {
  const rows = Array.isArray(result) ? result : (result ? [result] : []);
  if (!rows.length) return result;

  const ids = rows
    .map((row) => safeAsId(row && row.subscriptionDayId))
    .filter((id) => id && OBJECT_ID_RE.test(id));
  const pairs = rows
    .filter((row) => row && row.subscriptionId && row.date)
    .map((row) => ({ subscriptionId: safeAsId(row.subscriptionId), date: row.date }))
    .filter((pair) => pair.subscriptionId && pair.date);

  const or = [];
  if (ids.length) or.push({ _id: { $in: ids } });
  if (pairs.length) or.push(...pairs);
  if (!or.length) return result;

  const days = await SubscriptionDay.find({ $or: or }).lean();
  const byId = new Map(days.map((day) => [safeAsId(day._id), day]));
  const byPair = new Map(days.map((day) => [`${safeAsId(day.subscriptionId)}:${day.date}`, day]));

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const id = safeAsId(row.subscriptionDayId);
    const subscriptionId = safeAsId(row.subscriptionId);
    const day = (id && byId.get(id)) || byPair.get(`${subscriptionId}:${row.date}`) || null;
    if (!day) continue;
    try {
      row.__sourceDay = day;
    } catch (_err) {
      // Source-day enrichment is optional; never break a valid read.
    }
  }
  return result;
}

function installSafePickupQueryPatch() {
  if (globalThis[SAFE_QUERY_INSTALLED]) return;
  globalThis[SAFE_QUERY_INSTALLED] = true;

  const originals = {};
  for (const methodName of ["find", "findOne", "findById"]) {
    const original = SubscriptionPickupRequest[methodName];
    if (typeof original !== "function") continue;
    originals[methodName] = original;
    original[QUERY_PATCHED] = true;
  }

  // Install the canonical presentation patches while deliberately skipping its
  // unsafe query wrapper. Mongoose ObjectId exposes `_id === this`, which made
  // the old recursive id resolver overflow the stack on production reads.
  require("./installPickupCanonicalContract");

  for (const [methodName, original] of Object.entries(originals)) {
    const wrapped = function safeCanonicalPickupQuery(...args) {
      const query = original.apply(this, args);
      if (!query || typeof query.exec !== "function" || query[QUERY_EXEC_PATCHED]) return query;

      const originalExec = query.exec.bind(query);
      query.exec = async function safeCanonicalPickupExec(...execArgs) {
        const result = await originalExec(...execArgs);
        return attachSourceDaysSafe(result);
      };
      query[QUERY_EXEC_PATCHED] = true;
      return query;
    };
    wrapped[QUERY_PATCHED] = true;
    SubscriptionPickupRequest[methodName] = wrapped;
  }
}

installSafePickupQueryPatch();

module.exports = {
  attachSourceDaysSafe,
  installSafePickupQueryPatch,
  safeAsId,
};
