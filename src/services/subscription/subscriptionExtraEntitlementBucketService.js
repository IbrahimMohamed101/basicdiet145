"use strict";

const SubscriptionExtraEntitlementBucket = require("../../models/SubscriptionExtraEntitlementBucket");
const dateUtils = require("../../utils/date");

function extraWalletError(code, message, status = 409, details = {}) {
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

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeCurrency(value) {
  return normalizeText(value || "SAR").toUpperCase() || "SAR";
}

function count(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function money(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function id(value) {
  if (!value) return "";
  return String(value && value._id ? value._id : value);
}

function normalizeDate(value, fieldName) {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw extraWalletError(
      "STACKING_EXTRA_WALLET_DATE_INVALID",
      `${fieldName} must be a valid date`,
      422,
      { fieldName, value }
    );
  }
  return parsed;
}

function dateKey(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }
  return dateUtils.toKSADateString(normalizeDate(value, "businessDate"));
}

function deriveConservedCounters(row = {}, { includedTotalQty = 0 } = {}) {
  const remainingQty = count(row.remainingQty);
  const reservedQty = count(row.reservedQty);
  const consumedQty = count(row.consumedQty);
  const explicitForfeitedQty = count(row.forfeitedQty);
  const observed = remainingQty + reservedQty + consumedQty + explicitForfeitedQty;
  const purchasedQty = Math.max(
    count(row.purchasedQty),
    count(includedTotalQty),
    observed
  );
  const forfeitedQty = explicitForfeitedQty + Math.max(0, purchasedQty - observed);

  return {
    purchasedQty,
    remainingQty,
    reservedQty,
    consumedQty,
    forfeitedQty,
  };
}

function buildPremiumWalletKey(row = {}) {
  const premiumKey = normalizeKey(row.premiumKey);
  if (!premiumKey) {
    throw extraWalletError(
      "STACKING_PREMIUM_WALLET_KEY_REQUIRED",
      "Premium snapshot row requires premiumKey",
      422
    );
  }
  return [
    "premium",
    premiumKey,
    `config:${id(row.configId) || "none"}`,
    `revision:${count(row.revision)}`,
  ].join(":");
}

function buildAddonWalletKey(row = {}) {
  const addonId = id(row.addonId);
  const addonPlanId = id(row.addonPlanId);
  const entitlementKey = normalizeKey(row.entitlementKey);
  const balanceBucketId = id(row.balanceBucketId || row._id);
  const category = normalizeKey(row.category || row.allowanceCategory);
  const strongestId = addonPlanId || addonId;
  if (!strongestId) {
    throw extraWalletError(
      "STACKING_ADDON_WALLET_ID_REQUIRED",
      "Add-on balance snapshot requires addonPlanId or addonId",
      422
    );
  }
  return [
    "addon",
    `plan:${addonPlanId || "none"}`,
    `product:${addonId || "none"}`,
    `entitlement:${entitlementKey || "none"}`,
    `category:${category || "none"}`,
    `legacyBucket:${balanceBucketId || "none"}`,
  ].join(":");
}

function buildCommonPayload(batch = {}, kind, walletKey, row = {}) {
  const batchId = id(batch._id);
  if (!batchId || !batch.userId || !batch.containerSubscriptionId || !batch.sourceKey) {
    throw extraWalletError(
      "STACKING_EXTRA_WALLET_BATCH_INVALID",
      "Entitlement batch must include _id, userId, containerSubscriptionId, and sourceKey",
      422
    );
  }
  const effectiveStartDate = normalizeDate(batch.effectiveStartDate, "batch.effectiveStartDate");
  const validityEndDate = normalizeDate(
    batch.validityEndDate || batch.endDate,
    "batch.validityEndDate"
  );
  if (validityEndDate.getTime() < effectiveStartDate.getTime()) {
    throw extraWalletError(
      "STACKING_EXTRA_WALLET_DATE_RANGE_INVALID",
      "Extra entitlement validity cannot end before it starts",
      422
    );
  }

  return {
    bucketKey: `${batchId}:${kind}:${walletKey}`,
    kind,
    walletKey,
    userId: batch.userId,
    containerSubscriptionId: batch.containerSubscriptionId,
    entitlementBatchId: batch._id,
    sourceKey: String(batch.sourceKey),
    sourceType: String(batch.sourceType || ""),
    paymentId: batch.paymentId || null,
    checkoutDraftId: batch.checkoutDraftId || null,
    effectiveStartDate,
    validityEndDate,
    applicationState: String(batch.applicationState || "pending"),
    currency: normalizeCurrency(row.currency),
  };
}

function buildPremiumBucketPayload(batch, sourceRow) {
  const row = plain(sourceRow) || {};
  const walletKey = buildPremiumWalletKey(row);
  const counters = deriveConservedCounters(row);
  return {
    ...buildCommonPayload(batch, "premium", walletKey, row),
    premiumKey: normalizeKey(row.premiumKey),
    configId: row.configId || null,
    revision: count(row.revision),
    proteinId: row.proteinId || null,
    ...counters,
    unitPriceHalala: money(row.unitExtraFeeHalala),
    overageUnitPriceHalala: money(row.unitExtraFeeHalala),
    totalHalala: money(row.totalHalala),
    metadata: {
      sourceBalanceBucketId: id(row._id),
      kind: normalizeText(row.kind),
      entityType: normalizeText(row.entityType),
      selectionType: normalizeText(row.selectionType),
      sourceModel: normalizeText(row.sourceModel),
      sourceId: normalizeText(row.sourceId),
      sourceProductId: normalizeText(row.sourceProductId),
      sourceGroupId: normalizeText(row.sourceGroupId),
      sourceGroupKey: normalizeText(row.sourceGroupKey),
      sourcePremiumKey: normalizeText(row.sourceKey),
      name: row.name || "",
      nameI18n: row.nameI18n || null,
      imageUrl: normalizeText(row.imageUrl),
    },
  };
}

function findAddonEntitlementMetadata(batch, balanceRow = {}) {
  const subscriptions = batch
    && batch.addonSnapshot
    && Array.isArray(batch.addonSnapshot.subscriptions)
    ? batch.addonSnapshot.subscriptions
    : [];
  const addonPlanId = id(balanceRow.addonPlanId || balanceRow.addonId);
  const addonId = id(balanceRow.addonId);
  const entitlementKey = normalizeKey(balanceRow.entitlementKey);
  const category = normalizeKey(balanceRow.category || balanceRow.allowanceCategory);

  return subscriptions.find((entry) => {
    if (!entry) return false;
    const entryPlan = id(entry.addonPlanId || entry.addonId);
    const entryAddon = id(entry.addonId);
    const entryKey = normalizeKey(entry.entitlementKey);
    const entryCategory = normalizeKey(entry.category || entry.allowanceCategory);
    if (entitlementKey && entryKey && entitlementKey === entryKey) return true;
    if (addonPlanId && entryPlan && addonPlanId === entryPlan) return true;
    return Boolean(addonId && entryAddon && addonId === entryAddon && (!category || !entryCategory || category === entryCategory));
  }) || null;
}

function buildAddonBucketPayload(batch, sourceRow) {
  const row = plain(sourceRow) || {};
  const entitlement = plain(findAddonEntitlementMetadata(batch, row)) || {};
  const walletKey = buildAddonWalletKey(row);
  const includedTotalQty = Math.max(
    count(row.includedTotalQty),
    count(entitlement.includedTotalQty)
  );
  const counters = deriveConservedCounters(row, { includedTotalQty });

  return {
    ...buildCommonPayload(batch, "addon", walletKey, row),
    addonId: row.addonId || entitlement.addonId || null,
    addonPlanId: row.addonPlanId || entitlement.addonPlanId || null,
    balanceBucketId: row.balanceBucketId || row._id || null,
    entitlementKey: normalizeText(row.entitlementKey || entitlement.entitlementKey),
    category: normalizeText(row.category || entitlement.category),
    allowanceCategory: normalizeText(row.allowanceCategory || entitlement.allowanceCategory),
    frequency: normalizeText(row.frequency || entitlement.frequency),
    purchasedDailyQty: Math.max(
      count(row.purchasedDailyQty),
      count(entitlement.purchasedDailyQty || entitlement.quantityPerDay)
    ),
    includedTotalQty,
    ...counters,
    unitPriceHalala: money(row.unitPriceHalala || entitlement.unitPriceHalala),
    overageUnitPriceHalala: money(row.overageUnitPriceHalala),
    totalHalala: money(row.totalHalala || entitlement.totalHalala),
    metadata: {
      sourceBalanceBucketId: id(row.balanceBucketId || row._id),
      displayKey: normalizeText(row.displayKey || entitlement.displayKey),
      displayCategory: normalizeText(row.displayCategory || entitlement.displayCategory),
      name: row.name || entitlement.name || entitlement.addonPlanName || "",
      extraPurchasedQty: count(row.extraPurchasedQty),
      overageConsumedQty: count(row.overageConsumedQty),
      menuProductIds: Array.isArray(entitlement.menuProductIds) ? entitlement.menuProductIds : [],
      menuCategoryKeys: Array.isArray(entitlement.menuCategoryKeys) ? entitlement.menuCategoryKeys : [],
    },
  };
}

function assertBucketConservation(payload) {
  const conserved = count(payload.remainingQty)
    + count(payload.reservedQty)
    + count(payload.consumedQty)
    + count(payload.forfeitedQty);
  if (conserved !== count(payload.purchasedQty)) {
    throw extraWalletError(
      "STACKING_EXTRA_WALLET_CONSERVATION_FAILED",
      "Extra entitlement counters do not conserve purchased quantity",
      409,
      {
        bucketKey: payload.bucketKey,
        purchasedQty: payload.purchasedQty,
        conserved,
      }
    );
  }
  return payload;
}

function buildExtraBucketPayloadsFromBatch(batchInput) {
  const batch = plain(batchInput) || {};
  const premiumRows = Array.isArray(batch.premiumSnapshot) ? batch.premiumSnapshot : [];
  const addonRows = batch.addonSnapshot && Array.isArray(batch.addonSnapshot.balances)
    ? batch.addonSnapshot.balances
    : [];

  const payloads = [
    ...premiumRows.map((row) => buildPremiumBucketPayload(batch, row)),
    ...addonRows.map((row) => buildAddonBucketPayload(batch, row)),
  ].map(assertBucketConservation);

  const keys = new Set();
  for (const payload of payloads) {
    const identity = `${payload.kind}:${payload.walletKey}`;
    if (keys.has(identity)) {
      throw extraWalletError(
        "STACKING_EXTRA_WALLET_DUPLICATE_SNAPSHOT_IDENTITY",
        "A batch snapshot contains duplicate extra entitlement identity",
        409,
        { identity, entitlementBatchId: id(batch._id) }
      );
    }
    keys.add(identity);
  }
  return payloads;
}

function defaultRuntime() {
  return {
    async upsertBucket(payload, { session = null } = {}) {
      return SubscriptionExtraEntitlementBucket.updateOne(
        {
          entitlementBatchId: payload.entitlementBatchId,
          kind: payload.kind,
          walletKey: payload.walletKey,
        },
        { $setOnInsert: payload },
        { upsert: true, session }
      );
    },
    async findBuckets(entitlementBatchId, { session = null } = {}) {
      let query = SubscriptionExtraEntitlementBucket.find({ entitlementBatchId }).sort({ kind: 1, walletKey: 1 });
      if (session) query = query.session(session);
      return query.lean();
    },
  };
}

function resolveRuntime(runtimeOverrides = null) {
  const runtime = defaultRuntime();
  if (!runtimeOverrides || typeof runtimeOverrides !== "object" || Array.isArray(runtimeOverrides)) {
    return runtime;
  }
  return { ...runtime, ...runtimeOverrides };
}

function immutableBucketMatches(expected, actual) {
  if (!expected || !actual) return false;
  return String(actual.bucketKey || "") === String(expected.bucketKey || "")
    && String(actual.sourceKey || "") === String(expected.sourceKey || "")
    && id(actual.paymentId) === id(expected.paymentId)
    && id(actual.checkoutDraftId) === id(expected.checkoutDraftId)
    && id(actual.userId) === id(expected.userId)
    && id(actual.containerSubscriptionId) === id(expected.containerSubscriptionId)
    && id(actual.entitlementBatchId) === id(expected.entitlementBatchId)
    && id(actual.balanceBucketId) === id(expected.balanceBucketId)
    && String(actual.kind || "") === String(expected.kind || "")
    && String(actual.walletKey || "") === String(expected.walletKey || "")
    && count(actual.purchasedQty) === count(expected.purchasedQty)
    && money(actual.unitPriceHalala) === money(expected.unitPriceHalala)
    && normalizeCurrency(actual.currency) === normalizeCurrency(expected.currency)
    && new Date(actual.effectiveStartDate).getTime() === new Date(expected.effectiveStartDate).getTime()
    && new Date(actual.validityEndDate).getTime() === new Date(expected.validityEndDate).getTime();
}

async function ensureExtraBucketsForBatch({
  batch,
  session = null,
  runtime: runtimeOverrides = null,
} = {}) {
  const sourceBatch = plain(batch) || {};
  const payloads = buildExtraBucketPayloadsFromBatch(sourceBatch);
  if (!payloads.length) {
    return { buckets: [], createdOrExisting: 0, idempotent: true };
  }
  const runtime = resolveRuntime(runtimeOverrides);
  for (const payload of payloads) {
    await runtime.upsertBucket(payload, { session });
  }
  const buckets = await runtime.findBuckets(sourceBatch._id, { session });
  const actualByIdentity = new Map(
    buckets.map((row) => [`${row.kind}:${row.walletKey}`, row])
  );
  for (const expected of payloads) {
    const actual = actualByIdentity.get(`${expected.kind}:${expected.walletKey}`);
    if (!immutableBucketMatches(expected, actual)) {
      throw extraWalletError(
        "STACKING_EXTRA_WALLET_IDEMPOTENCY_CONFLICT",
        "Persisted extra entitlement bucket does not match its immutable batch snapshot",
        409,
        { bucketKey: expected.bucketKey }
      );
    }
  }
  if (buckets.length !== payloads.length) {
    throw extraWalletError(
      "STACKING_EXTRA_WALLET_BUCKET_COUNT_MISMATCH",
      "Persisted extra entitlement bucket count does not match the batch snapshot",
      409,
      {
        entitlementBatchId: id(sourceBatch._id),
        expectedCount: payloads.length,
        actualCount: buckets.length,
      }
    );
  }

  return {
    buckets,
    createdOrExisting: buckets.length,
    idempotent: true,
  };
}

function bucketEligibleOnDate(bucket, businessDate) {
  if (!bucket || String(bucket.applicationState || "") !== "applied") return false;
  const target = dateKey(businessDate);
  const start = dateUtils.toKSADateString(normalizeDate(bucket.effectiveStartDate, "bucket.effectiveStartDate"));
  const end = dateUtils.toKSADateString(normalizeDate(bucket.validityEndDate, "bucket.validityEndDate"));
  return target >= start && target <= end;
}

function sumCounters(rows) {
  return rows.reduce((acc, row) => {
    acc.purchasedQty += count(row.purchasedQty);
    acc.remainingQty += count(row.remainingQty);
    acc.reservedQty += count(row.reservedQty);
    acc.consumedQty += count(row.consumedQty);
    acc.forfeitedQty += count(row.forfeitedQty);
    return acc;
  }, {
    purchasedQty: 0,
    remainingQty: 0,
    reservedQty: 0,
    consumedQty: 0,
    forfeitedQty: 0,
  });
}

function groupProjection(rows, keyFn) {
  const grouped = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  return Array.from(grouped.entries()).map(([key, fundingBuckets]) => ({
    key,
    ...sumCounters(fundingBuckets),
    fundingBuckets: fundingBuckets.map((row) => ({
      id: id(row._id),
      entitlementBatchId: id(row.entitlementBatchId),
      walletKey: row.walletKey,
      remainingQty: count(row.remainingQty),
      reservedQty: count(row.reservedQty),
      consumedQty: count(row.consumedQty),
      forfeitedQty: count(row.forfeitedQty),
      effectiveStartDate: row.effectiveStartDate,
      validityEndDate: row.validityEndDate,
    })),
  }));
}

function projectExtraEntitlements({ buckets = [], businessDate } = {}) {
  const eligible = (Array.isArray(buckets) ? buckets : [])
    .filter((bucket) => bucketEligibleOnDate(bucket, businessDate));
  const premiumRows = eligible.filter((row) => row.kind === "premium");
  const addonRows = eligible.filter((row) => row.kind === "addon");

  const premium = groupProjection(
    premiumRows,
    (row) => normalizeKey(row.premiumKey) || row.walletKey
  );
  const addons = groupProjection(
    addonRows,
    (row) => normalizeKey(row.entitlementKey) || normalizeKey(row.category) || row.walletKey
  );

  return {
    businessDate: dateKey(businessDate),
    eligibleBucketCount: eligible.length,
    premium,
    addons,
    premiumTotals: sumCounters(premiumRows),
    addonTotals: sumCounters(addonRows),
  };
}

module.exports = {
  assertBucketConservation,
  bucketEligibleOnDate,
  buildAddonBucketPayload,
  buildAddonWalletKey,
  buildExtraBucketPayloadsFromBatch,
  buildPremiumBucketPayload,
  buildPremiumWalletKey,
  deriveConservedCounters,
  ensureExtraBucketsForBatch,
  immutableBucketMatches,
  projectExtraEntitlements,
};
