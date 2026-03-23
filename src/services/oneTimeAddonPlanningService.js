const { pickLang } = require("../utils/i18n");
const { createLocalizedError } = require("../utils/errorLocalization");

const ONE_TIME_ADDON_PAYMENT_STATUS_PENDING = "pending";
const ONE_TIME_ADDON_PAYMENT_STATUS_PAID = "paid";

function normalizeOneTimeAddonCategoryKey(value, addonId) {
  const raw = String(value || "").trim();
  return raw || String(addonId || "").trim();
}

function normalizeRequestedAddonIds(requestedAddonIds) {
  if (requestedAddonIds === undefined) return undefined;
  if (!Array.isArray(requestedAddonIds)) {
    throw createLocalizedError({
      code: "VALIDATION_ERROR",
      key: "errors.validation.oneTimeAddonSelectionsArray",
      fallbackMessage: "oneTimeAddonSelections must be an array",
    });
  }
  return requestedAddonIds.filter(Boolean);
}

function normalizeOneTimeAddonSelections({
  requestedAddonIds,
  addonDocs = [],
  lang = "ar",
} = {}) {
  const normalizedIds = normalizeRequestedAddonIds(requestedAddonIds);
  if (normalizedIds === undefined) return undefined;

  const addonById = new Map(
    (Array.isArray(addonDocs) ? addonDocs : []).map((doc) => [String(doc._id), doc])
  );
  const seenCategories = new Set();

  return normalizedIds.map((addonId) => {
    const doc = addonById.get(String(addonId));
    if (!doc || doc.isActive === false || String(doc.type || "") !== "one_time") {
      throw createLocalizedError({
        code: "INVALID_ONE_TIME_ADDON_SELECTION",
        key: "errors.addon.oneTimeNotFoundOrInactive",
        params: { addonId: String(addonId) },
        fallbackMessage: `One-time addon ${addonId} not found or inactive`,
      });
    }

    const category = normalizeOneTimeAddonCategoryKey(doc.category, addonId);
    if (seenCategories.has(category)) {
      throw createLocalizedError({
        code: "ONE_TIME_ADDON_CATEGORY_CONFLICT",
        key: "errors.addon.oneTimeCategoryConflict",
        fallbackMessage: "One-time add-ons may include at most one item per category",
      });
    }
    seenCategories.add(category);

    return {
      addonId: doc._id,
      name: pickLang(doc.name, lang) || "",
      category,
    };
  });
}

function recomputeOneTimeAddonPlanningState({ day, selections } = {}) {
  if (!day) return null;

  const finalSelections = Array.isArray(selections)
    ? selections.map((row) => ({
      addonId: row.addonId,
      name: String(row.name || ""),
      category: normalizeOneTimeAddonCategoryKey(row.category, row.addonId),
    }))
    : [];

  const pendingCount = finalSelections.length;

  day.oneTimeAddonSelections = finalSelections;
  day.oneTimeAddonPendingCount = pendingCount;
  day.oneTimeAddonPaymentStatus = pendingCount > 0
    ? ONE_TIME_ADDON_PAYMENT_STATUS_PENDING
    : undefined;

  return {
    oneTimeAddonSelections: finalSelections,
    oneTimeAddonPendingCount: pendingCount,
    oneTimeAddonPaymentStatus: pendingCount > 0 ? ONE_TIME_ADDON_PAYMENT_STATUS_PENDING : null,
  };
}

function resolveEffectiveOneTimeAddonPlanning({ day } = {}) {
  if (!day) return null;

  if (day.fulfilledSnapshot && Array.isArray(day.fulfilledSnapshot.oneTimeAddonSelections)) {
    return {
      oneTimeAddonSelections: day.fulfilledSnapshot.oneTimeAddonSelections,
      oneTimeAddonPendingCount: Number(day.fulfilledSnapshot.oneTimeAddonPendingCount || 0),
      oneTimeAddonPaymentStatus: day.fulfilledSnapshot.oneTimeAddonPaymentStatus || null,
    };
  }

  if (day.lockedSnapshot && Array.isArray(day.lockedSnapshot.oneTimeAddonSelections)) {
    return {
      oneTimeAddonSelections: day.lockedSnapshot.oneTimeAddonSelections,
      oneTimeAddonPendingCount: Number(day.lockedSnapshot.oneTimeAddonPendingCount || 0),
      oneTimeAddonPaymentStatus: day.lockedSnapshot.oneTimeAddonPaymentStatus || null,
    };
  }

  return {
    oneTimeAddonSelections: Array.isArray(day.oneTimeAddonSelections) ? day.oneTimeAddonSelections : [],
    oneTimeAddonPendingCount: Number(day.oneTimeAddonPendingCount || 0),
    oneTimeAddonPaymentStatus: day.oneTimeAddonPaymentStatus || null,
  };
}

function buildOneTimeAddonPlanningSnapshot({ day } = {}) {
  if (!day) return null;

  const hasSelections = Array.isArray(day.oneTimeAddonSelections);
  const hasPendingCount = day.oneTimeAddonPendingCount !== undefined && day.oneTimeAddonPendingCount !== null;
  const hasPaymentStatus = day.oneTimeAddonPaymentStatus !== undefined && day.oneTimeAddonPaymentStatus !== null;

  if (!hasSelections && !hasPendingCount && !hasPaymentStatus) {
    return null;
  }

  return {
    oneTimeAddonSelections: hasSelections ? day.oneTimeAddonSelections : [],
    oneTimeAddonPendingCount: Number(day.oneTimeAddonPendingCount || 0),
    oneTimeAddonPaymentStatus: day.oneTimeAddonPaymentStatus || null,
  };
}

function normalizeOneTimeAddonPaymentSnapshotRows(selections = []) {
  return (Array.isArray(selections) ? selections : [])
    .map((row) => ({
      addonId: String(row && row.addonId ? row.addonId : "").trim(),
      name: String(row && row.name ? row.name : ""),
      category: normalizeOneTimeAddonCategoryKey(row && row.category, row && row.addonId),
    }))
    .filter((row) => row.addonId)
    .sort((a, b) => (
      a.category.localeCompare(b.category)
      || a.addonId.localeCompare(b.addonId)
      || a.name.localeCompare(b.name)
    ));
}

function buildOneTimeAddonPaymentSnapshot({ day } = {}) {
  const oneTimeAddonSelections = normalizeOneTimeAddonPaymentSnapshotRows(
    day && Array.isArray(day.oneTimeAddonSelections) ? day.oneTimeAddonSelections : []
  );
  return {
    oneTimeAddonSelections,
    oneTimeAddonCount: oneTimeAddonSelections.length,
  };
}

function matchesOneTimeAddonPaymentSnapshot({ day, oneTimeAddonSelections } = {}) {
  const current = buildOneTimeAddonPaymentSnapshot({ day }).oneTimeAddonSelections;
  const expected = normalizeOneTimeAddonPaymentSnapshotRows(oneTimeAddonSelections);

  if (current.length !== expected.length) {
    return false;
  }

  return current.every((row, index) => (
    row.addonId === expected[index].addonId
    && row.name === expected[index].name
    && row.category === expected[index].category
  ));
}

function assertNoPendingOneTimeAddonPayment({ day } = {}) {
  const effective = resolveEffectiveOneTimeAddonPlanning({ day });
  if (!effective) return null;

  if (
    Number(effective.oneTimeAddonPendingCount || 0) > 0
    && effective.oneTimeAddonPaymentStatus !== ONE_TIME_ADDON_PAYMENT_STATUS_PAID
  ) {
    throw createLocalizedError({
      code: "ONE_TIME_ADDON_PAYMENT_REQUIRED",
      key: "errors.planning.oneTimeAddonRequired",
      fallbackMessage: "One-time add-on payment is required before confirmation",
    });
  }

  return effective;
}

module.exports = {
  ONE_TIME_ADDON_PAYMENT_STATUS_PENDING,
  ONE_TIME_ADDON_PAYMENT_STATUS_PAID,
  normalizeOneTimeAddonCategoryKey,
  normalizeRequestedAddonIds,
  normalizeOneTimeAddonSelections,
  recomputeOneTimeAddonPlanningState,
  resolveEffectiveOneTimeAddonPlanning,
  buildOneTimeAddonPlanningSnapshot,
  normalizeOneTimeAddonPaymentSnapshotRows,
  buildOneTimeAddonPaymentSnapshot,
  matchesOneTimeAddonPaymentSnapshot,
  assertNoPendingOneTimeAddonPayment,
};
