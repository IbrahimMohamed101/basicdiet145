"use strict";

const SubscriptionExtraEntitlementBucket = require(
  "../../models/SubscriptionExtraEntitlementBucket"
);
const { logger } = require("../../utils/logger");
const {
  bucketEligibleOnDate,
  projectExtraEntitlements,
} = require("./subscriptionExtraEntitlementBucketService");
const {
  isReadStackingEnabledForUser,
  isWriteStackingEnabledForUser,
} = require("./subscriptionStackingRolloutPolicyService");

const READ_EVENT = "subscription_stacking_extra_read_projection";
const READ_ERROR_CODE = "STACKING_EXTRA_READ_UNAVAILABLE";

function readError(cause) {
  const err = new Error("Stacking Add-on and Premium balances are temporarily unavailable");
  err.code = READ_ERROR_CODE;
  err.status = 503;
  err.details = {
    cause: cause && cause.message ? cause.message : String(cause || "unknown error"),
  };
  return err;
}

function plain(value) {
  if (!value) return value;
  return typeof value.toObject === "function" ? value.toObject() : value;
}

function count(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function money(value) {
  return count(value);
}

function text(value) {
  return String(value || "").trim();
}

function key(value) {
  return text(value).toLowerCase();
}

function id(value) {
  if (!value) return "";
  return String(value && value._id ? value._id : value);
}

function firstValue(rows, getter, fallback = null) {
  for (const row of rows) {
    const value = getter(row);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return fallback;
}

function uniqueValues(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = id(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(value);
  }
  return result;
}

function sameIdentityOrNull(rows, getter) {
  const values = uniqueValues(rows.map(getter));
  return values.length === 1 ? values[0] : null;
}

function addonEntitlementKey(row = {}) {
  return key(row.entitlementKey)
    || key(row.category || row.allowanceCategory)
    || key(row.walletKey);
}

function findLegacyAddonRows(subscription, entitlementKey, fundingBuckets) {
  const rows = Array.isArray(subscription && subscription.addonSubscriptions)
    ? subscription.addonSubscriptions.filter(Boolean)
    : [];
  const planIds = new Set(
    fundingBuckets
      .flatMap((row) => [id(row.addonPlanId), id(row.addonId)])
      .filter(Boolean)
  );
  const exact = rows.filter((row) => key(row.entitlementKey) === entitlementKey);
  if (exact.length) return exact;
  return rows.filter((row) => planIds.has(id(row.addonPlanId || row.addonId)));
}

function collectMenuProductIds(rows, fundingBuckets) {
  return uniqueValues([
    ...rows.flatMap((row) => Array.isArray(row.menuProductIds) ? row.menuProductIds : []),
    ...fundingBuckets.flatMap((row) => (
      row.metadata && Array.isArray(row.metadata.menuProductIds)
        ? row.metadata.menuProductIds
        : []
    )),
  ]);
}

function collectMenuCategoryKeys(rows, fundingBuckets) {
  return [...new Set([
    ...rows.flatMap((row) => Array.isArray(row.menuCategoryKeys) ? row.menuCategoryKeys : []),
    ...fundingBuckets.flatMap((row) => (
      row.metadata && Array.isArray(row.metadata.menuCategoryKeys)
        ? row.metadata.menuCategoryKeys
        : []
    )),
  ].map(text).filter(Boolean))];
}

function buildAddonRows(subscription, addonGroups) {
  return addonGroups
    .filter((group) => count(group.purchasedQty) > 0)
    .map((group) => {
      const fundingBuckets = group.fundingBucketsSource;
      const legacyRows = findLegacyAddonRows(subscription, group.key, fundingBuckets);
      const metadataRows = [...legacyRows, ...fundingBuckets];
      const metadata = firstValue(
        fundingBuckets,
        (row) => row.metadata && typeof row.metadata === "object" ? row.metadata : null,
        {}
      );
      const addonPlanId = sameIdentityOrNull(
        fundingBuckets,
        (row) => row.addonPlanId || row.addonId
      ) || firstValue(legacyRows, (row) => row.addonPlanId || row.addonId);
      const addonId = sameIdentityOrNull(
        fundingBuckets,
        (row) => row.addonId || row.addonPlanId
      ) || firstValue(legacyRows, (row) => row.addonId || row.addonPlanId);
      const category = text(firstValue(
        metadataRows,
        (row) => row.category || row.allowanceCategory
      ));
      const allowanceCategory = text(firstValue(
        metadataRows,
        (row) => row.allowanceCategory || row.category,
        category
      ));
      const displayKey = text(firstValue(
        metadataRows,
        (row) => row.displayKey || row.displayCategory || row.metadata?.displayKey,
        category
      ));
      const name = firstValue(
        metadataRows,
        (row) => row.addonPlanName || row.name || row.metadata?.name,
        ""
      );
      const unitPriceHalala = money(firstValue(
        metadataRows,
        (row) => row.unitPriceHalala || row.unitPlanPriceHalala || row.priceHalala,
        0
      ));
      const overageUnitPriceHalala = money(firstValue(
        metadataRows,
        (row) => row.overageUnitPriceHalala || row.unitPriceHalala || row.unitPlanPriceHalala,
        unitPriceHalala
      ));
      const currency = text(firstValue(metadataRows, (row) => row.currency, "SAR")) || "SAR";
      const purchasedDailyQty = Math.max(
        1,
        ...metadataRows.map((row) => count(row.purchasedDailyQty || row.quantityPerDay))
      );
      const maxPerDay = Math.max(
        purchasedDailyQty,
        ...legacyRows.map((row) => count(row.maxPerDay || row.quantityPerDay))
      );

      const balance = {
        addonPlanId: addonPlanId || null,
        addonId: addonId || null,
        entitlementKey: group.key,
        // An aggregated wallet is not any one of its persisted funding buckets.
        balanceBucketId: null,
        name,
        category,
        allowanceCategory,
        displayKey,
        displayCategory: displayKey,
        purchasedDailyQty,
        includedTotalQty: count(group.purchasedQty),
        purchasedQty: count(group.purchasedQty),
        remainingQty: count(group.remainingQty),
        reservedQty: count(group.reservedQty),
        consumedQty: count(group.consumedQty),
        forfeitedQty: count(group.forfeitedQty),
        extraPurchasedQty: 0,
        overageConsumedQty: 0,
        unitIncludedPriceHalala: unitPriceHalala,
        unitPriceHalala,
        overageUnitPriceHalala,
        currency,
      };
      const entitlement = {
        ...legacyRows[0],
        addonPlanId: addonPlanId || null,
        addonId: addonId || addonPlanId || null,
        name: text(typeof name === "string" ? name : ""),
        addonPlanName: text(firstValue(legacyRows, (row) => row.addonPlanName || row.name, typeof name === "string" ? name : "")),
        addonPlanNameI18n: firstValue(legacyRows, (row) => row.addonPlanNameI18n, null),
        category,
        allowanceCategory,
        displayKey,
        displayCategory: displayKey,
        entitlementKey: group.key,
        balanceBucketId: null,
        maxPerDay,
        quantityPerDay: purchasedDailyQty,
        purchasedDailyQty,
        includedTotalQty: count(group.purchasedQty),
        unitPlanPriceHalala: unitPriceHalala,
        unitPriceHalala,
        currency,
        menuProductIds: collectMenuProductIds(legacyRows, fundingBuckets),
        menuCategoryKeys: collectMenuCategoryKeys(legacyRows, fundingBuckets),
        ...(legacyRows.some((row) => Array.isArray(row.menuProductsSnapshot))
          ? { menuProductsSnapshot: legacyRows.flatMap((row) => row.menuProductsSnapshot || []) }
          : {}),
        projectionSource: "applied_extra_entitlement_buckets",
      };
      return { balance, entitlement };
    });
}

function buildPremiumRows(premiumGroups) {
  return premiumGroups
    .filter((group) => count(group.purchasedQty) > 0)
    .map((group) => {
      const rows = group.fundingBucketsSource;
      const metadata = firstValue(
        rows,
        (row) => row.metadata && typeof row.metadata === "object" ? row.metadata : null,
        {}
      );
      return {
        premiumKey: group.key,
        configId: sameIdentityOrNull(rows, (row) => row.configId),
        revision: rows.every((row) => count(row.revision) === count(rows[0]?.revision))
          ? count(rows[0]?.revision)
          : 0,
        proteinId: sameIdentityOrNull(rows, (row) => row.proteinId),
        kind: text(metadata.kind),
        entityType: text(metadata.entityType) || "premium_meal",
        selectionType: text(metadata.selectionType),
        sourceModel: text(metadata.sourceModel),
        sourceId: text(metadata.sourceId),
        sourceProductId: text(metadata.sourceProductId),
        sourceGroupId: text(metadata.sourceGroupId),
        sourceGroupKey: text(metadata.sourceGroupKey),
        sourceKey: text(metadata.sourcePremiumKey),
        name: metadata.name || "",
        nameI18n: metadata.nameI18n || null,
        imageUrl: text(metadata.imageUrl),
        purchasedQty: count(group.purchasedQty),
        remainingQty: count(group.remainingQty),
        reservedQty: count(group.reservedQty),
        consumedQty: count(group.consumedQty),
        forfeitedQty: count(group.forfeitedQty),
        unitExtraFeeHalala: money(firstValue(rows, (row) => row.unitPriceHalala, 0)),
        currency: text(firstValue(rows, (row) => row.currency, "SAR")) || "SAR",
        projectionSource: "applied_extra_entitlement_buckets",
      };
    });
}

function buildCategoryCompatibility(addonBalance) {
  const byCategory = new Map();
  for (const row of addonBalance) {
    const category = key(row.allowanceCategory || row.category);
    if (!category) continue;
    const current = byCategory.get(category) || {
      category,
      includedTotalQty: 0,
      remainingIncludedQty: 0,
      reservedQty: 0,
      consumedQty: 0,
      forfeitedQty: 0,
      overageUnitPriceHalala: 0,
      currency: row.currency || "SAR",
      hasBalanceBucket: true,
      aggregateCompatibilityOnly: true,
    };
    current.includedTotalQty += count(row.purchasedQty);
    current.remainingIncludedQty += count(row.remainingQty);
    current.reservedQty += count(row.reservedQty);
    current.consumedQty += count(row.consumedQty);
    current.forfeitedQty += count(row.forfeitedQty);
    current.overageUnitPriceHalala = Math.max(
      current.overageUnitPriceHalala,
      money(row.overageUnitPriceHalala)
    );
    byCategory.set(category, current);
  }

  const addonCategoryAllowances = [...byCategory.values()];
  const addonBalanceSummary = Object.fromEntries(addonCategoryAllowances.map((row) => [
    row.category,
    {
      totalUnits: row.includedTotalQty,
      remainingUnits: row.remainingIncludedQty,
      reservedUnits: row.reservedQty,
      consumedUnits: row.consumedQty,
      forfeitedUnits: row.forfeitedQty,
      canConsumeNow: row.remainingIncludedQty > 0,
      unitPolicy: "TOTAL_BALANCE_WITHIN_VALIDITY",
      aggregateCompatibilityOnly: true,
    },
  ]));
  return { addonCategoryAllowances, addonBalanceSummary };
}

function buildAddonSubscriptionAllowances(addonRows) {
  return addonRows.map(({ balance, entitlement }, entitlementIndex) => ({
    entitlementIndex,
    entitlementKey: balance.entitlementKey,
    addonPlanId: balance.addonPlanId,
    addonId: balance.addonId,
    addonPlanName: entitlement.addonPlanName || entitlement.name || "",
    category: entitlement.displayCategory || balance.category,
    entitlementCategory: balance.allowanceCategory || balance.category,
    displayCategory: entitlement.displayCategory || balance.category,
    allowanceCategory: balance.allowanceCategory || balance.category,
    balanceBucketId: null,
    balanceMatchSource: "aggregated_entitlement_key",
    includedTotalQty: balance.purchasedQty,
    consumedQty: balance.consumedQty,
    reservedQty: balance.reservedQty,
    forfeitedQty: balance.forfeitedQty,
    remainingIncludedQty: balance.remainingQty,
    overageUnitPriceHalala: balance.overageUnitPriceHalala,
    currency: balance.currency,
    choicesCount: entitlement.menuProductIds.length,
    menuProductIds: entitlement.menuProductIds,
    maxPerDay: entitlement.maxPerDay,
    source: "subscription",
    allowanceScope: "addon_subscription",
    sourceOfTruth: true,
    spendable: balance.remainingQty > 0,
    aggregateCompatibilityOnly: false,
  }));
}

function buildStackingExtraReadProjection({ subscription = null, buckets = [], businessDate } = {}) {
  const eligibleBuckets = (Array.isArray(buckets) ? buckets : [])
    .map(plain)
    .filter((bucket) => bucketEligibleOnDate(bucket, businessDate));
  const grouped = projectExtraEntitlements({ buckets: eligibleBuckets, businessDate });
  const premiumSourceByKey = new Map();
  const addonSourceByKey = new Map();
  for (const bucket of eligibleBuckets) {
    const target = bucket.kind === "premium" ? premiumSourceByKey : addonSourceByKey;
    const identity = bucket.kind === "premium"
      ? key(bucket.premiumKey) || key(bucket.walletKey)
      : addonEntitlementKey(bucket);
    if (!identity) continue;
    if (!target.has(identity)) target.set(identity, []);
    target.get(identity).push(bucket);
  }
  const addonGroups = grouped.addons.map((group) => ({
    ...group,
    fundingBucketsSource: addonSourceByKey.get(group.key) || [],
  }));
  const premiumGroups = grouped.premium.map((group) => ({
    ...group,
    fundingBucketsSource: premiumSourceByKey.get(group.key) || [],
  }));
  const addonRows = buildAddonRows(subscription, addonGroups);
  const addonBalance = addonRows.map((row) => row.balance);
  const addonSubscriptions = addonRows.map((row) => row.entitlement);
  const premiumBalance = buildPremiumRows(premiumGroups);
  const { addonCategoryAllowances, addonBalanceSummary } = buildCategoryCompatibility(addonBalance);
  const addonSubscriptionAllowances = buildAddonSubscriptionAllowances(addonRows);
  const premiumSummary = premiumBalance.map((row) => ({
    premiumKey: row.premiumKey,
    purchasedQtyTotal: row.purchasedQty,
    remainingQtyTotal: row.remainingQty,
    reservedQtyTotal: row.reservedQty,
    consumedQtyTotal: row.consumedQty,
    forfeitedQtyTotal: row.forfeitedQty,
  }));

  return {
    businessDate: grouped.businessDate,
    eligibleBucketCount: grouped.eligibleBucketCount,
    addonBalance,
    addonSubscriptions,
    addonSubscriptionAllowances,
    addonCategoryAllowances,
    addonBalanceSummary,
    premiumBalance,
    premiumSummary,
  };
}

function applyStackingExtraReadProjection(subscription, projection) {
  if (!subscription || typeof subscription !== "object" || !projection) return subscription;
  return {
    ...subscription,
    addonBalance: projection.addonBalance,
    addonSubscriptions: projection.addonSubscriptions,
    addonSubscriptionAllowances: projection.addonSubscriptionAllowances,
    addonCategoryAllowances: projection.addonCategoryAllowances,
    addonBalanceSummary: projection.addonBalanceSummary,
    premiumBalance: projection.premiumBalance,
    premiumSummary: projection.premiumSummary,
  };
}

function defaultRuntime() {
  return {
    readEnabledForUser: (userId) => isReadStackingEnabledForUser(userId),
    writeEnabledForUser: (userId) => isWriteStackingEnabledForUser(userId),
    findBuckets({ userId, containerSubscriptionId }) {
      return SubscriptionExtraEntitlementBucket.find({
        userId,
        containerSubscriptionId,
        applicationState: "applied",
      }).sort({ kind: 1, effectiveStartDate: 1, validityEndDate: 1, _id: 1 }).lean();
    },
    info: (message, meta) => logger.info(message, meta),
    error: (message, meta) => logger.error(message, meta),
  };
}

function resolveRuntime(runtimeOverrides = null) {
  const runtime = defaultRuntime();
  return runtimeOverrides && typeof runtimeOverrides === "object" && !Array.isArray(runtimeOverrides)
    ? { ...runtime, ...runtimeOverrides }
    : runtime;
}

function isStackingExtraReadProjectionEnabledForSubscription(subscription, runtimeOverrides = null) {
  if (!subscription || typeof subscription !== "object") return false;
  const runtime = resolveRuntime(runtimeOverrides);
  return runtime.readEnabledForUser(id(subscription.userId));
}

async function loadStackingExtraReadBuckets(subscription, runtimeOverrides = null) {
  if (!subscription || typeof subscription !== "object") return null;
  const runtime = resolveRuntime(runtimeOverrides);
  const userId = id(subscription.userId);
  const containerSubscriptionId = id(subscription._id || subscription.subscriptionId);
  if (!runtime.readEnabledForUser(userId)) return null;

  try {
    if (!userId || !containerSubscriptionId) {
      throw new Error("subscription userId and container identity are required");
    }
    const buckets = await runtime.findBuckets({ userId, containerSubscriptionId });
    if (!Array.isArray(buckets)) throw new Error("extra entitlement bucket query returned an invalid result");
    runtime.info(READ_EVENT, {
      outcome: "loaded",
      userId,
      subscriptionId: containerSubscriptionId,
      bucketCount: buckets.length,
    });
    return buckets;
  } catch (err) {
    runtime.error(READ_EVENT, {
      outcome: "error",
      userId,
      subscriptionId: containerSubscriptionId,
      error: err && err.message ? err.message : String(err),
    });
    if (runtime.writeEnabledForUser(userId)) throw readError(err);
    return null;
  }
}

async function projectSubscriptionStackingExtrasForRead(
  subscription,
  businessDate,
  runtimeOverrides = null
) {
  const buckets = await loadStackingExtraReadBuckets(subscription, runtimeOverrides);
  if (buckets === null) return subscription;
  try {
    const projection = buildStackingExtraReadProjection({ subscription, buckets, businessDate });
    return applyStackingExtraReadProjection(subscription, projection);
  } catch (err) {
    const runtime = resolveRuntime(runtimeOverrides);
    if (runtime.writeEnabledForUser(id(subscription && subscription.userId))) throw readError(err);
    return subscription;
  }
}

module.exports = {
  READ_ERROR_CODE,
  READ_EVENT,
  applyStackingExtraReadProjection,
  buildStackingExtraReadProjection,
  isStackingExtraReadProjectionEnabledForSubscription,
  loadStackingExtraReadBuckets,
  projectSubscriptionStackingExtrasForRead,
};
