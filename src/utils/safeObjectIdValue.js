"use strict";

function safeObjectIdString(value, seen = new WeakSet()) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    const text = String(value).trim();
    return text || null;
  }
  if (typeof value !== "object") {
    try {
      const text = String(value).trim();
      return text || null;
    } catch (_error) {
      return null;
    }
  }
  if (seen.has(value)) return null;
  seen.add(value);
  try {
    if (typeof value.toHexString === "function") {
      const text = String(value.toHexString()).trim();
      return text || null;
    }
    if (Object.prototype.hasOwnProperty.call(value, "_id") && value._id !== value) {
      return safeObjectIdString(value._id, seen);
    }
    if (Object.prototype.hasOwnProperty.call(value, "id") && value.id !== value) {
      return safeObjectIdString(value.id, seen);
    }
    const text = String(value).trim();
    return text && text !== "[object Object]" ? text : null;
  } catch (_error) {
    return null;
  }
}

function sanitizeObjectIdCycles(value, state = null) {
  const context = state || { seen: new WeakMap() };
  if (value === undefined || value === null) return value;
  if (typeof value !== "object") return value;
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) return Buffer.from(value);
  if (typeof value.toHexString === "function") return safeObjectIdString(value);
  if (context.seen.has(value)) return null;

  const output = Array.isArray(value) ? [] : {};
  context.seen.set(value, output);

  const source = !Array.isArray(value) && typeof value.toObject === "function"
    ? (() => {
      try {
        const converted = value.toObject({ getters: false, virtuals: false, depopulate: false });
        return converted && converted !== value ? converted : value;
      } catch (_error) {
        return value;
      }
    })()
    : value;

  if (source !== value && context.seen.has(source)) return context.seen.get(source);
  if (source !== value && typeof source === "object" && source !== null) context.seen.set(source, output);

  for (const key of Object.keys(source)) {
    const nested = source[key];
    if ((key === "_id" || key === "id") && nested && typeof nested === "object") {
      const id = safeObjectIdString(nested);
      output[key] = id;
      continue;
    }
    output[key] = sanitizeObjectIdCycles(nested, context);
  }
  return output;
}

module.exports = {
  safeObjectIdString,
  sanitizeObjectIdCycles,
};
