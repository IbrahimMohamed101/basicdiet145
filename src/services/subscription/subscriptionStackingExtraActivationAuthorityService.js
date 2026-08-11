"use strict";

const mongoose = require("mongoose");
const {
  buildAddonBalanceRowsFromEntitlements,
} = require("./subscriptionAddonBalanceService");
const {
  buildAddonWalletKey,
  buildPremiumWalletKey,
} = require("./subscriptionExtraEntitlementBucketService");

const EXTRA_ACTIVATION_AUTHORITY_VERSION =
  "subscription_stacking.extra_activation.v1";

function authorityError(code, message, status = 422, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.details = details;
  return err;
}

function plain(value) {
  if (!value) return value;
  return typeof value.toObject === "function" ? value.toObject() : value;
}

function objectId(value, fieldName) {
  const normalized = String(value && value._id ? value._id : value || "").trim();
  if (!mongoose.Types.ObjectId.isValid(normalized)) {
    throw authorityError(
      "STACKING_EXTRA_ACTIVATION_ID_INVALID",
      `${fieldName} must be a valid ObjectId`,
      422,
      { fieldName }
    );
  }
  return new mongoose.Types.ObjectId(normalized);
}

function nonNegativeInteger(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw authorityError(
      "STACKING_EXTRA_ACTIVATION_QUANTITY_INVALID",
      `${fieldName} must be a non-negative safe integer`,
      422,
      { fieldName, value }
    );
  }
  return parsed;
}

function positiveInteger(value, fieldName) {
  const parsed = nonNegativeInteger(value, fieldName);
  if (parsed < 1) {
    throw authorityError(
      "STACKING_EXTRA_ACTIVATION_QUANTITY_INVALID",
      `${fieldName} must be a positive safe integer`,
      422,
      { fieldName, value }
    );
  }
  return parsed;
}

function text(value, fieldName) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw authorityError(
      "STACKING_EXTRA_ACTIVATION_IDENTITY_REQUIRED",
      `${fieldName} is required`,
      422,
      { fieldName }
    );
  }
  return normalized;
}

function premiumKey(value) {
  const normalized = text(value, "premiumKey").toLowerCase();
  if (!/^[a-z0-9][a-z0-9._:-]*$/.test(normalized)) {
    throw authorityError(
      "STACKING_EXTRA_ACTIVATION_PREMIUM_KEY_INVALID",
      "premiumKey is invalid",
      422,
      { premiumKey: normalized }
    );
  }
  return normalized;
}

function normalizePremiumRow(rowInput, index) {
  const row = plain(rowInput) || {};
  const purchasedQty = positiveInteger(
    row.purchasedQty != null ? row.purchasedQty : row.qty,
    `premium[${index}].purchasedQty`
  );
  const remainingQty = row.remainingQty == null
    ? purchasedQty
    : nonNegativeInteger(row.remainingQty, `premium[${index}].remainingQty`);
  const reservedQty = nonNegativeInteger(row.reservedQty ?? 0, `premium[${index}].reservedQty`);
  const consumedQty = nonNegativeInteger(row.consumedQty ?? 0, `premium[${index}].consumedQty`);
  const forfeitedQty = nonNegativeInteger(row.forfeitedQty ?? 0, `premium[${index}].forfeitedQty`);
  if (remainingQty + reservedQty + consumedQty + forfeitedQty !== purchasedQty) {
    throw authorityError(
      "STACKING_EXTRA_ACTIVATION_CONSERVATION_FAILED",
      "Premium snapshot counters do not conserve purchased quantity",
      422,
      { index, purchasedQty }
    );
  }

  return {
    ...row,
    premiumKey: premiumKey(row.premiumKey),
    configId: row.configId ? objectId(row.configId, `premium[${index}].configId`) : null,
    proteinId: row.proteinId ? objectId(row.proteinId, `premium[${index}].proteinId`) : null,
    revision: nonNegativeInteger(row.revision ?? 0, `premium[${index}].revision`),
    purchasedQty,
    remainingQty,
    reservedQty,
    consumedQty,
    forfeitedQty,
    unitExtraFeeHalala: nonNegativeInteger(
      row.unitExtraFeeHalala ?? 0,
      `premium[${index}].unitExtraFeeHalala`
    ),
    totalHalala: nonNegativeInteger(row.totalHalala ?? 0, `premium[${index}].totalHalala`),
    currency: String(row.currency || "SAR").trim().toUpperCase() || "SAR",
  };
}

function normalizeAddonSubscription(rowInput, index) {
  const row = plain(rowInput) || {};
  const resolvedPlanId = objectId(
    row.addonPlanId || row.addonId,
    `addons.subscriptions[${index}].addonPlanId`
  );
  const category = text(row.category, `addons.subscriptions[${index}].category`);
  return {
    ...row,
    addonPlanId: resolvedPlanId,
    addonId: objectId(row.addonId || row.addonPlanId, `addons.subscriptions[${index}].addonId`),
    category,
    entitlementKey: String(row.entitlementKey || `${category}:${resolvedPlanId}`),
    purchasedDailyQty: positiveInteger(
      row.purchasedDailyQty != null ? row.purchasedDailyQty : row.quantityPerDay,
      `addons.subscriptions[${index}].purchasedDailyQty`
    ),
    includedTotalQty: positiveInteger(
      row.includedTotalQty,
      `addons.subscriptions[${index}].includedTotalQty`
    ),
  };
}

function normalizeAddonBalance(rowInput, index) {
  const row = plain(rowInput) || {};
  const purchasedQty = positiveInteger(row.purchasedQty, `addons.balances[${index}].purchasedQty`);
  const remainingQty = row.remainingQty == null
    ? purchasedQty
    : nonNegativeInteger(row.remainingQty, `addons.balances[${index}].remainingQty`);
  const reservedQty = nonNegativeInteger(row.reservedQty ?? 0, `addons.balances[${index}].reservedQty`);
  const consumedQty = nonNegativeInteger(row.consumedQty ?? 0, `addons.balances[${index}].consumedQty`);
  const forfeitedQty = nonNegativeInteger(row.forfeitedQty ?? 0, `addons.balances[${index}].forfeitedQty`);
  if (remainingQty + reservedQty + consumedQty + forfeitedQty !== purchasedQty) {
    throw authorityError(
      "STACKING_EXTRA_ACTIVATION_CONSERVATION_FAILED",
      "Add-on snapshot counters do not conserve purchased quantity",
      422,
      { index, purchasedQty }
    );
  }

  return {
    ...row,
    balanceBucketId: objectId(row.balanceBucketId, `addons.balances[${index}].balanceBucketId`),
    addonPlanId: objectId(row.addonPlanId, `addons.balances[${index}].addonPlanId`),
    addonId: objectId(row.addonId, `addons.balances[${index}].addonId`),
    category: text(row.category, `addons.balances[${index}].category`),
    entitlementKey: text(row.entitlementKey, `addons.balances[${index}].entitlementKey`),
    purchasedDailyQty: positiveInteger(
      row.purchasedDailyQty,
      `addons.balances[${index}].purchasedDailyQty`
    ),
    includedTotalQty: positiveInteger(
      row.includedTotalQty,
      `addons.balances[${index}].includedTotalQty`
    ),
    purchasedQty,
    remainingQty,
    reservedQty,
    consumedQty,
    forfeitedQty,
    unitPriceHalala: nonNegativeInteger(
      row.unitPriceHalala ?? 0,
      `addons.balances[${index}].unitPriceHalala`
    ),
    overageUnitPriceHalala: nonNegativeInteger(
      row.overageUnitPriceHalala ?? 0,
      `addons.balances[${index}].overageUnitPriceHalala`
    ),
    totalHalala: nonNegativeInteger(row.totalHalala ?? 0, `addons.balances[${index}].totalHalala`),
    currency: String(row.currency || "SAR").trim().toUpperCase() || "SAR",
  };
}

function assertUniqueRows(premiumRows, addonRows) {
  const identities = new Set();
  for (const row of premiumRows) {
    const identity = `premium:${buildPremiumWalletKey(row)}`;
    if (identities.has(identity)) {
      throw authorityError(
        "STACKING_EXTRA_ACTIVATION_DUPLICATE_IDENTITY",
        "Premium snapshot contains a duplicate wallet identity",
        422,
        { identity }
      );
    }
    identities.add(identity);
  }
  for (const row of addonRows) {
    const identity = `addon:${buildAddonWalletKey(row)}`;
    if (identities.has(identity)) {
      throw authorityError(
        "STACKING_EXTRA_ACTIVATION_DUPLICATE_IDENTITY",
        "Add-on snapshot contains a duplicate wallet identity",
        422,
        { identity }
      );
    }
    identities.add(identity);
  }
}

function normalizePinnedExtraActivationSnapshot(snapshotInput) {
  const snapshot = plain(snapshotInput);
  if (!snapshot || snapshot.version !== EXTRA_ACTIVATION_AUTHORITY_VERSION) {
    throw authorityError(
      "STACKING_EXTRA_ACTIVATION_AUTHORITY_INVALID",
      "Pinned extra activation authority is missing or unsupported",
      409
    );
  }
  const premium = (Array.isArray(snapshot.premium) ? snapshot.premium : [])
    .map(normalizePremiumRow);
  const addonSource = snapshot.addons && typeof snapshot.addons === "object"
    ? snapshot.addons
    : {};
  const subscriptions = (Array.isArray(addonSource.subscriptions)
    ? addonSource.subscriptions
    : []).map(normalizeAddonSubscription);
  const balances = (Array.isArray(addonSource.balances)
    ? addonSource.balances
    : []).map(normalizeAddonBalance);
  if (subscriptions.length !== balances.length) {
    throw authorityError(
      "STACKING_EXTRA_ACTIVATION_ADDON_SNAPSHOT_MISMATCH",
      "Pinned add-on subscriptions and balances must have the same cardinality",
      422
    );
  }
  assertUniqueRows(premium, balances);
  return {
    version: EXTRA_ACTIVATION_AUTHORITY_VERSION,
    premium,
    addons: { subscriptions, balances },
  };
}

function buildPinnedExtraActivationSnapshot({
  premiumItems = [],
  addonSubscriptions = [],
  daysCount,
} = {}) {
  const premium = (Array.isArray(premiumItems) ? premiumItems : []).map((row) => ({
    ...plain(row),
    purchasedQty: row.qty,
    remainingQty: row.qty,
    reservedQty: 0,
    consumedQty: 0,
    forfeitedQty: 0,
  }));
  const subscriptions = (Array.isArray(addonSubscriptions) ? addonSubscriptions : [])
    .map((row) => ({ ...plain(row) }));
  const balances = buildAddonBalanceRowsFromEntitlements(subscriptions, { daysCount })
    .map((row) => ({
      ...row,
      balanceBucketId: new mongoose.Types.ObjectId(),
      forfeitedQty: 0,
    }));
  return normalizePinnedExtraActivationSnapshot({
    version: EXTRA_ACTIVATION_AUTHORITY_VERSION,
    premium,
    addons: { subscriptions, balances },
  });
}

function hasExtras(value = {}) {
  return Boolean(
    (Array.isArray(value.premiumBalance) && value.premiumBalance.length)
    || (Array.isArray(value.addonSubscriptions) && value.addonSubscriptions.length)
    || (Array.isArray(value.addonBalance) && value.addonBalance.length)
  );
}

function resolvePinnedExtraActivationSnapshot({ draft, subscriptionPayload } = {}) {
  const finalization = plain(draft && draft.stackingFinalization) || {};
  const snapshot = finalization.extraEntitlements;
  if (!snapshot) {
    if (
      (draft && Array.isArray(draft.premiumItems) && draft.premiumItems.length)
      || (draft && Array.isArray(draft.addonSubscriptions) && draft.addonSubscriptions.length)
      || hasExtras(subscriptionPayload)
    ) {
      throw authorityError(
        "STACKING_EXTRA_ACTIVATION_AUTHORITY_MISSING",
        "Paid extras cannot be activated without a pinned checkout-time authority",
        409
      );
    }
    return {
      version: EXTRA_ACTIVATION_AUTHORITY_VERSION,
      premium: [],
      addons: { subscriptions: [], balances: [] },
    };
  }
  return normalizePinnedExtraActivationSnapshot(snapshot);
}

function attachPinnedExtraActivationSnapshot(finalizationIntent, args = {}) {
  if (!finalizationIntent) return finalizationIntent;
  return {
    ...plain(finalizationIntent),
    extraEntitlements: buildPinnedExtraActivationSnapshot(args),
  };
}

module.exports = {
  EXTRA_ACTIVATION_AUTHORITY_VERSION,
  attachPinnedExtraActivationSnapshot,
  buildPinnedExtraActivationSnapshot,
  normalizePinnedExtraActivationSnapshot,
  resolvePinnedExtraActivationSnapshot,
};
