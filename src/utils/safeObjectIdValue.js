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

function createSanitizeContext(state = null) {
  if (state && state.seen instanceof WeakMap) {
    if (!(state.active instanceof WeakSet)) state.active = new WeakSet();
    return state;
  }
  return {
    seen: new WeakMap(),
    active: new WeakSet(),
  };
}

function sanitizeObjectIdCycles(value, state = null) {
  const context = createSanitizeContext(state);
  if (value === undefined || value === null) return value;
  if (typeof value !== "object") return value;
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) return Buffer.from(value);
  if (typeof value.toHexString === "function") return safeObjectIdString(value);

  if (context.seen.has(value)) {
    // Repeated references are common in pickup availability: the same item is
    // exposed in pickupItems and again in sections.items. They are not cycles
    // and must remain present. Only a reference to an object still being walked
    // is a real cycle and should be cut.
    return context.active.has(value) ? null : context.seen.get(value);
  }

  const output = Array.isArray(value) ? [] : {};
  context.seen.set(value, output);
  context.active.add(value);

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

  if (source !== value && typeof source === "object" && source !== null) {
    if (context.seen.has(source) && context.active.has(source)) {
      context.active.delete(value);
      return null;
    }
    context.seen.set(source, output);
    context.active.add(source);
  }

  for (const key of Object.keys(source)) {
    const nested = source[key];
    if ((key === "_id" || key === "id") && nested && typeof nested === "object") {
      const id = safeObjectIdString(nested);
      output[key] = id;
      continue;
    }
    output[key] = sanitizeObjectIdCycles(nested, context);
  }

  context.active.delete(value);
  if (source !== value && typeof source === "object" && source !== null) {
    context.active.delete(source);
  }
  return output;
}

module.exports = {
  safeObjectIdString,
  sanitizeObjectIdCycles,
};