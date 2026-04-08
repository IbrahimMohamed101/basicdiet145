const { localizeField, t } = require("./i18n");

const RAW_DAY_STATUS_TO_CLIENT_STATUS = {
  open: "open",
  frozen: "frozen",
  locked: "preparing",
  in_preparation: "preparing",
  out_for_delivery: "on_the_way",
  ready_for_pickup: "ready_for_pickup",
  fulfilled: "fulfilled",
  delivery_canceled: "delivery_canceled",
  canceled_at_branch: "canceled_at_branch",
  no_show: "no_show",
  skipped: "skipped",
};

function resolveLocalizedText(value, lang) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value !== "object" || Array.isArray(value)) return "";

  // Standard bilingual object shape used across plans, meals, add-ons, and snapshots.
  if (Object.prototype.hasOwnProperty.call(value, "ar") || Object.prototype.hasOwnProperty.call(value, "en")) {
    return localizeField(value, lang);
  }

  // Backward-compatible fallback for rows that already expose a display-oriented `name`.
  if (Object.prototype.hasOwnProperty.call(value, "name")) {
    return resolveLocalizedText(value.name, lang);
  }

  // Legacy custom item shape still stored on historical custom meal/salad snapshots.
  if (
    Object.prototype.hasOwnProperty.call(value, "name_ar")
    || Object.prototype.hasOwnProperty.call(value, "name_en")
  ) {
    if (lang === "en") {
      return String(value.name_en || value.name_ar || "");
    }
    return String(value.name_ar || value.name_en || "");
  }

  return "";
}

function resolveFirstLocalizedText(candidates, lang) {
  const values = Array.isArray(candidates) ? candidates : [candidates];
  for (const value of values) {
    const resolved = resolveLocalizedText(value, lang);
    if (resolved) return resolved;
  }
  return "";
}

function resolveScopedText(scope, namespace, key, lang, params = {}) {
  if (!key) return "";
  const path = `${scope}.${namespace}.${key}`;
  const translated = t(path, lang, params);
  return translated === path ? "" : translated;
}

function resolveReadLabel(namespace, key, lang) {
  return resolveScopedText("read", namespace, key, lang);
}

function resolveCatalogOrStoredName({
  id = null,
  liveName = "",
  storedName = "",
  lang,
  preferStoredName = false,
} = {}) {
  void id;
  const normalizedStoredName = resolveFirstLocalizedText([storedName], lang);
  const normalizedLiveName = resolveFirstLocalizedText([liveName], lang);

  if (preferStoredName) {
    return normalizedStoredName || normalizedLiveName || "";
  }
  return normalizedLiveName || normalizedStoredName || "";
}

function localizeAddonRows(
  rows,
  {
    lang,
    addonNames = new Map(),
    preferStoredName = false,
    alwaysSetName = true,
  } = {}
) {
  if (!Array.isArray(rows)) return rows;

  return rows.map((row) => {
    if (!row || typeof row !== "object") return row;

    const addonId = row.addonId ? String(row.addonId) : null;
    const name = resolveCatalogOrStoredName({
      id: addonId,
      liveName: addonId ? addonNames.get(addonId) || "" : "",
      storedName: row.name,
      lang,
      preferStoredName,
    });

    if (!name && !alwaysSetName) {
      return row;
    }

    return {
      ...row,
      name,
    };
  });
}

function localizeCustomItemRows(rows, lang) {
  if (!Array.isArray(rows)) return rows;

  return rows.map((row) => {
    if (!row || typeof row !== "object") return row;

    return {
      ...row,
      items: Array.isArray(row.items)
        ? row.items.map((item) => ({
          ...item,
          name: resolveFirstLocalizedText([item], lang),
        }))
        : [],
    };
  });
}

function localizeStatusObject(
  payload,
  {
    lang,
    namespace = "paymentStatuses",
    statusField = "status",
    labelField = "statusLabel",
    scope = "read",
  } = {}
) {
  if (!payload || typeof payload !== "object") return payload;

  const statusLabel = resolveScopedText(scope, namespace, payload[statusField], lang);
  if (!statusLabel) return payload;

  return {
    ...payload,
    [labelField]: statusLabel,
  };
}

function mapRawDayStatusToClientStatus(status) {
  const normalized = String(status || "").trim();
  return RAW_DAY_STATUS_TO_CLIENT_STATUS[normalized] || normalized;
}

module.exports = {
  RAW_DAY_STATUS_TO_CLIENT_STATUS,
  localizeAddonRows,
  localizeCustomItemRows,
  localizeStatusObject,
  mapRawDayStatusToClientStatus,
  resolveCatalogOrStoredName,
  resolveFirstLocalizedText,
  resolveLocalizedText,
  resolveReadLabel,
  resolveScopedText,
};
