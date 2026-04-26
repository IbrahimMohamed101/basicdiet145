function hasOwn(obj, key) {
  return Boolean(obj) && Object.prototype.hasOwnProperty.call(obj, key);
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value).trim();
}

function parseMaybeJsonString(value) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }

  const looksLikeJson =
    (trimmed.startsWith("{") && trimmed.endsWith("}"))
    || (trimmed.startsWith("[") && trimmed.endsWith("]"));

  if (!looksLikeJson) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch (_err) {
    return value;
  }
}

function getBodyValue(body, fieldNames) {
  if (!body || !Array.isArray(fieldNames)) {
    return undefined;
  }

  for (const fieldName of fieldNames) {
    if (hasOwn(body, fieldName)) {
      return parseMaybeJsonString(body[fieldName]);
    }
  }

  return undefined;
}

function normalizeLocalizedLeaf(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value).trim();
}

function parseLocalizedFieldFromBody(body, fieldName, { preserveMissing = false, allowString = false } = {}) {
  const directValue = getBodyValue(body, [fieldName]);

  if (allowString && typeof directValue === "string") {
    const value = directValue.trim();
    return value ? { ar: "", en: value } : { ar: "", en: "" };
  }

  if (directValue && typeof directValue === "object" && !Array.isArray(directValue)) {
    const parsed = {};
    if (hasOwn(directValue, "ar")) parsed.ar = normalizeLocalizedLeaf(directValue.ar);
    if (hasOwn(directValue, "en")) parsed.en = normalizeLocalizedLeaf(directValue.en);

    if (!preserveMissing) {
      if (!hasOwn(parsed, "ar")) parsed.ar = "";
      if (!hasOwn(parsed, "en")) parsed.en = "";
    }

    return Object.keys(parsed).length ? parsed : null;
  }

  const arValue = getBodyValue(body, [`${fieldName}_ar`, `${fieldName}.ar`, `${fieldName}[ar]`]);
  const enValue = getBodyValue(body, [`${fieldName}_en`, `${fieldName}.en`, `${fieldName}[en]`]);

  if (arValue !== undefined || enValue !== undefined) {
    const parsed = {};
    if (arValue !== undefined) parsed.ar = normalizeLocalizedLeaf(arValue);
    if (enValue !== undefined) parsed.en = normalizeLocalizedLeaf(enValue);

    if (!preserveMissing) {
      if (!hasOwn(parsed, "ar")) parsed.ar = "";
      if (!hasOwn(parsed, "en")) parsed.en = "";
    }

    return Object.keys(parsed).length ? parsed : null;
  }

  return null;
}

function parseBooleanField(value, fieldName, { defaultValue } = {}) {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
    if (!normalized && defaultValue !== undefined) {
      return defaultValue;
    }
  }

  throw { status: 400, code: "INVALID", message: `${fieldName} must be a boolean` };
}

module.exports = {
  getBodyValue,
  hasOwn,
  normalizeOptionalString,
  parseBooleanField,
  parseLocalizedFieldFromBody,
  parseMaybeJsonString,
};
