"use strict";

const mongoose = require("mongoose");
const Addon = require("../models/Addon");
const AddonPlanPrice = require("../models/AddonPlanPrice");
const MenuProduct = require("../models/MenuProduct");
const subscriptionQuoteService = require("./subscription/subscriptionQuoteService");
const { applyPromoCodeToSubscriptionQuote } = require("./promoCodeService");
const { VAT_PERCENTAGE } = require("../config/vat");
const { computeInclusiveVatBreakdown } = require("../utils/pricing");
const { pickLang } = require("../utils/i18n");
const {
  resolveAddonChargeTotalHalala,
  resolveSubscriptionAddonBillingMode,
} = require("../utils/subscription/subscriptionCatalog");

const SYSTEM_CURRENCY = "SAR";
const STATE_KEY = Symbol.for(
  "basicdiet.subscriptionAddonPlanAvailabilityPolicy.state"
);
const WRAPPED_KEY = Symbol.for(
  "basicdiet.subscriptionAddonPlanAvailabilityPolicy.wrapped"
);

function clean(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => clean(value)).filter(Boolean))];
}

function createAddonSelectionError(code, message, field, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = code === "ADDON_PLAN_NOT_FOUND"
    ? 404
    : code === "INVALID_ADDON_SELECTION"
      ? 400
      : 422;
  error.field = field;
  error.details = { field, ...details };
  return error;
}

function normalizeQuantityPerDay(raw, index) {
  const source = isPlainObject(raw) ? raw : {};
  const value = source.quantityPerDay !== undefined
    ? source.quantityPerDay
    : source.qty !== undefined
      ? source.qty
      : source.quantity;
  if (value === undefined) return 1;
  const quantity = Number(value);
  if (!Number.isInteger(quantity) || quantity < 1 || typeof value === "string") {
    throw createAddonSelectionError(
      "INVALID_ADDON_SELECTION",
      "quantityPerDay must be an integer >= 1",
      `addons[${index}].quantityPerDay`
    );
  }
  return quantity;
}

function resolveAddonPlanId(raw) {
  if (typeof raw === "string") return clean(raw);
  if (!isPlainObject(raw)) return "";
  return clean(raw.addonPlanId || raw.addonId || raw.id);
}

function hasExplicitProductSelection(raw) {
  if (!isPlainObject(raw)) return false;
  if (clean(raw.productId || raw.menuProductId)) return true;
  return Array.isArray(raw.menuProductIds) && raw.menuProductIds.some((id) => clean(id));
}

function isPlanOnlySelection(raw) {
  return Boolean(resolveAddonPlanId(raw)) && !hasExplicitProductSelection(raw);
}

function isNewSaleProductUsable(product) {
  return Boolean(product)
    && product.isActive !== false
    && product.isVisible !== false
    && product.isAvailable !== false
    && product.publishedAt != null
    && clean(product.kind).toLowerCase() !== "plan"
    && clean(product.type).toLowerCase() !== "subscription"
    && clean(product.itemType).toLowerCase() !== "subscription"
    && clean(product.billingMode).toLowerCase() !== "per_day";
}

function normalizePlanOnlyForwardedSelection(raw, planId, quantityPerDay, productIds) {
  const base = isPlainObject(raw) ? { ...raw } : {};
  delete base.id;
  delete base.addonId;
  delete base.productId;
  delete base.menuProductId;
  return {
    ...base,
    addonPlanId: planId,
    quantityPerDay,
    menuProductIds: productIds,
  };
}

const defaultRuntime = {
  async loadAddonPlans(ids) {
    if (!ids.length) return [];
    return Addon.find({
      _id: { $in: ids },
      isArchived: { $ne: true },
    }).lean();
  },
  async loadMenuProducts(ids) {
    if (!ids.length) return [];
    return MenuProduct.find({ _id: { $in: ids } }).lean();
  },
  async loadAddonPlanPrices(addonPlanIds, basePlanId) {
    if (!addonPlanIds.length) return [];
    return AddonPlanPrice.find({
      addonPlanId: { $in: addonPlanIds },
      basePlanId,
      isActive: true,
    }).lean();
  },
  async applyPromoCode({ promoCode, userId, quote }) {
    return applyPromoCodeToSubscriptionQuote({ promoCode, userId, quote });
  },
};

function resolveRuntime(overrides = {}) {
  return { ...defaultRuntime, ...(overrides || {}) };
}

async function preparePlanOnlyAddonSelections(payload, runtimeOverrides = {}) {
  const rawAddons = payload && payload.addons;
  if (!Array.isArray(rawAddons) || rawAddons.length === 0) {
    return {
      payload,
      deferredSelections: [],
      changed: false,
    };
  }

  const runtime = resolveRuntime(runtimeOverrides);
  const planOnlyRows = rawAddons
    .map((raw, index) => ({ raw, index, planId: resolveAddonPlanId(raw) }))
    .filter((row) => isPlanOnlySelection(row.raw) && mongoose.Types.ObjectId.isValid(row.planId));
  if (!planOnlyRows.length) {
    return {
      payload,
      deferredSelections: [],
      changed: false,
    };
  }

  const planIds = uniqueStrings(planOnlyRows.map((row) => row.planId));
  const plans = await runtime.loadAddonPlans(planIds);
  const planById = new Map((plans || []).map((plan) => [String(plan._id), plan]));
  const linkedProductIds = uniqueStrings(
    (plans || []).flatMap((plan) => Array.isArray(plan.menuProductIds) ? plan.menuProductIds : [])
  );
  const products = await runtime.loadMenuProducts(linkedProductIds);
  const productById = new Map((products || []).map((product) => [String(product._id), product]));

  const deferredByPlanId = new Map();
  const forwardedAddons = [];
  let changed = false;

  for (let index = 0; index < rawAddons.length; index += 1) {
    const raw = rawAddons[index];
    const planId = resolveAddonPlanId(raw);
    if (!isPlanOnlySelection(raw) || !mongoose.Types.ObjectId.isValid(planId)) {
      forwardedAddons.push(raw);
      continue;
    }

    const plan = planById.get(planId);
    if (!plan) {
      forwardedAddons.push(raw);
      continue;
    }

    const quantityPerDay = normalizeQuantityPerDay(raw, index);
    const availableProductIds = uniqueStrings(plan.menuProductIds || []).filter((productId) => (
      isNewSaleProductUsable(productById.get(productId))
    ));

    changed = true;
    if (availableProductIds.length) {
      forwardedAddons.push(
        normalizePlanOnlyForwardedSelection(
          raw,
          planId,
          quantityPerDay,
          availableProductIds
        )
      );
      continue;
    }

    const existing = deferredByPlanId.get(planId);
    if (existing) {
      existing.quantityPerDay += quantityPerDay;
    } else {
      deferredByPlanId.set(planId, {
        addonPlanId: planId,
        quantityPerDay,
        sourceRequestShape: typeof raw === "string" ? "legacy_string_id" : "object",
        addonPlan: plan,
      });
    }
  }

  return {
    payload: changed ? { ...payload, addons: forwardedAddons } : payload,
    deferredSelections: [...deferredByPlanId.values()],
    changed,
  };
}

function validateDeferredPlanOrThrow(row) {
  const plan = row && row.addonPlan;
  const addonPlanId = clean(row && row.addonPlanId);
  if (!plan) {
    throw createAddonSelectionError(
      "ADDON_PLAN_NOT_FOUND",
      "Add-on plan was not found",
      "addonPlanId",
      { addonPlanId }
    );
  }
  if (plan.kind !== "plan") {
    throw createAddonSelectionError(
      "INVALID_ADDON_SELECTION",
      "Add-on selection must reference a subscription plan",
      "addonPlanId",
      { addonPlanId }
    );
  }
  if (plan.isActive === false) {
    throw createAddonSelectionError(
      "ADDON_PLAN_INACTIVE",
      "Add-on plan is inactive",
      "addonPlanId",
      { addonPlanId }
    );
  }
  if (resolveSubscriptionAddonBillingMode(plan, { defaultMode: "per_day" }) !== "per_day") {
    throw createAddonSelectionError(
      "INVALID_ADDON_SELECTION",
      "Add-on plan must use per_day billing for subscription checkout",
      "addonPlanId",
      { addonPlanId }
    );
  }
  if (clean(plan.currency || SYSTEM_CURRENCY).toUpperCase() !== SYSTEM_CURRENCY) {
    throw createAddonSelectionError(
      "INVALID_ADDON_SELECTION",
      `Add-on plan currency must be ${SYSTEM_CURRENCY}`,
      "addonPlanId",
      { addonPlanId }
    );
  }
  return plan;
}

function buildDeferredAddonSubscription({ item, plan, quote, lang }) {
  const addonPlanId = plan._id;
  const allowanceCategory = plan.allowanceCategory || item.category || plan.category;
  return {
    addonId: addonPlanId,
    addonPlanId,
    name: pickLang(plan.name, lang),
    addonPlanName: pickLang(plan.name, lang),
    addonPlanNameI18n: plan.name || null,
    category: item.category || plan.category,
    allowanceCategory,
    displayKey: plan.displayKey || plan.displayCategory || plan.category,
    displayCategory: plan.displayCategory || plan.displayKey || plan.category,
    entitlementKey: `${allowanceCategory || "addon"}:${addonPlanId}`,
    sortOrder: Number(plan.sortOrder || 0),
    maxPerDay: plan.maxPerDay || 1,
    basePlanId: quote.plan._id,
    priceHalala: Number(item.unitPriceHalala || 0),
    quantityPerDay: Number(item.quantityPerDay || item.qty || 1),
    purchasedDailyQty: Number(item.quantityPerDay || item.qty || 1),
    includedTotalQty: Number(item.includedTotalQty || 0),
    unitPlanPriceHalala: Number(item.unitPlanPriceHalala || item.unitPriceHalala || 0),
    totalHalala: Number(item.totalHalala || 0),
    currency: item.currency || SYSTEM_CURRENCY,
    menuProductIds: [],
    menuCategoryKeys: Array.isArray(plan.menuCategoryKeys)
      ? plan.menuCategoryKeys.map(String)
      : [],
    priceSource: "base_plan_addon_price",
    sourceRequestShape: item.sourceRequestShape || null,
  };
}

function recomputeQuoteBreakdown(quote) {
  const breakdown = quote.breakdown || {};
  const basePlanPriceHalala = Number(breakdown.basePlanPriceHalala || 0);
  const premiumTotalHalala = Number(breakdown.premiumTotalHalala || 0);
  const addonsTotalHalala = Number(breakdown.addonsTotalHalala || 0);
  const deliveryFeeHalala = Number(breakdown.deliveryFeeHalala || 0);
  const grossTotalHalala = basePlanPriceHalala
    + premiumTotalHalala
    + addonsTotalHalala
    + deliveryFeeHalala;
  const vatBreakdown = computeInclusiveVatBreakdown(grossTotalHalala, VAT_PERCENTAGE);
  quote.breakdown = {
    ...breakdown,
    grossTotalHalala,
    subtotalHalala: vatBreakdown.subtotalHalala,
    subtotalBeforeVatHalala: vatBreakdown.subtotalBeforeVatHalala,
    vatPercentage: vatBreakdown.vatPercentage,
    vatHalala: vatBreakdown.vatHalala,
    totalHalala: vatBreakdown.totalHalala,
  };
  return quote;
}

async function appendDeferredAddonPlansToQuote(
  quote,
  deferredSelections,
  {
    lang = "ar",
    runtime: runtimeOverrides = {},
  } = {}
) {
  if (!Array.isArray(deferredSelections) || deferredSelections.length === 0) {
    return quote;
  }
  if (!quote || !quote.plan || !quote.plan._id) {
    throw new Error("Cannot attach add-on plans without a resolved base plan quote");
  }

  const runtime = resolveRuntime(runtimeOverrides);
  const planIds = uniqueStrings(deferredSelections.map((row) => row.addonPlanId));
  const prices = await runtime.loadAddonPlanPrices(planIds, quote.plan._id);
  const priceByPlanId = new Map((prices || []).map((row) => [String(row.addonPlanId), row]));
  quote.addonItems = Array.isArray(quote.addonItems) ? quote.addonItems : [];
  quote.addonSubscriptions = Array.isArray(quote.addonSubscriptions)
    ? quote.addonSubscriptions
    : [];

  let addedTotalHalala = 0;
  for (const row of deferredSelections) {
    const plan = validateDeferredPlanOrThrow(row);
    const addonPlanId = String(plan._id);
    const matrixPrice = priceByPlanId.get(addonPlanId);
    if (!matrixPrice) {
      const error = new Error(
        `Addon plan ${addonPlanId} is not configured for the selected base plan`
      );
      error.code = "PRICE_MATRIX_NOT_FOUND";
      error.status = 422;
      throw error;
    }

    const unitPriceHalala = Number(matrixPrice.priceHalala);
    if (!Number.isSafeInteger(unitPriceHalala) || unitPriceHalala < 0) {
      const error = new Error(`Addon plan ${addonPlanId} has invalid pricing`);
      error.code = "INVALID_SELECTION";
      error.status = 422;
      throw error;
    }

    const quantityPerDay = Number(row.quantityPerDay || 1);
    const daysCount = Number(quote.plan.daysCount || 0);
    const includedTotalQty = daysCount * quantityPerDay;
    const totalHalala = resolveAddonChargeTotalHalala({
      unitPriceHalala,
      qty: quantityPerDay,
      daysCount,
      mealsPerDay: Number(quote.mealsPerDay || 0),
      addon: plan,
    });
    const item = {
      addon: plan,
      addonPlanId: plan._id,
      productId: null,
      menuProductIds: [],
      products: [],
      category: plan.category,
      qty: quantityPerDay,
      quantityPerDay,
      billingMode: resolveSubscriptionAddonBillingMode(plan, { defaultMode: "per_day" }),
      durationDays: daysCount,
      daysCount,
      includedTotalQty,
      unitPlanPriceHalala: unitPriceHalala,
      unitPriceHalala,
      totalHalala,
      priceHalala: totalHalala,
      currency: SYSTEM_CURRENCY,
      sourceRequestShape: row.sourceRequestShape || null,
    };
    quote.addonItems.push(item);
    quote.addonSubscriptions.push(
      buildDeferredAddonSubscription({ item, plan, quote, lang })
    );
    addedTotalHalala += totalHalala;
  }

  quote.breakdown = {
    ...(quote.breakdown || {}),
    addonsTotalHalala: Number(quote.breakdown && quote.breakdown.addonsTotalHalala || 0)
      + addedTotalHalala,
  };
  recomputeQuoteBreakdown(quote);
  quote.addonBalance = subscriptionQuoteService.buildAddonBalanceRowsFromQuote(quote);
  return quote;
}

function createAddonPlanAvailabilityQuoteResolver({
  original,
  runtime: runtimeOverrides = {},
} = {}) {
  if (typeof original !== "function") {
    throw new TypeError("original quote resolver is required");
  }
  const runtime = resolveRuntime(runtimeOverrides);

  return async function addonPlanAvailabilityCompatibleQuote(payload, options = {}) {
    const prepared = await preparePlanOnlyAddonSelections(payload, runtime);
    if (!prepared.deferredSelections.length) {
      return original(prepared.payload, options);
    }

    const promoCode = payload && payload.promoCode;
    const quotePayload = promoCode
      ? { ...prepared.payload, promoCode: undefined }
      : prepared.payload;
    let quote = await original(quotePayload, options);
    quote = await appendDeferredAddonPlansToQuote(
      quote,
      prepared.deferredSelections,
      {
        lang: options.lang || "ar",
        runtime,
      }
    );

    if (promoCode) {
      const promoResult = await runtime.applyPromoCode({
        promoCode,
        userId: options.userId || null,
        quote,
      });
      quote = promoResult.quote;
      quote.addonBalance = subscriptionQuoteService.buildAddonBalanceRowsFromQuote(quote);
    }
    return quote;
  };
}

function installSubscriptionAddonPlanAvailabilityPolicy() {
  const state = globalThis[STATE_KEY] || { installed: false };
  globalThis[STATE_KEY] = state;
  if (state.installed) return;
  state.installed = true;

  const original = subscriptionQuoteService.resolveCheckoutQuoteOrThrow;
  const wrapped = createAddonPlanAvailabilityQuoteResolver({ original });
  Object.defineProperty(wrapped, WRAPPED_KEY, {
    value: true,
    configurable: false,
  });
  Object.defineProperty(wrapped, "__subscriptionAddonPlanAvailabilityPolicy", {
    value: true,
    configurable: false,
  });
  subscriptionQuoteService.resolveCheckoutQuoteOrThrow = wrapped;
}

installSubscriptionAddonPlanAvailabilityPolicy();

module.exports = {
  appendDeferredAddonPlansToQuote,
  createAddonPlanAvailabilityQuoteResolver,
  hasExplicitProductSelection,
  installSubscriptionAddonPlanAvailabilityPolicy,
  isNewSaleProductUsable,
  isPlanOnlySelection,
  preparePlanOnlyAddonSelections,
  recomputeQuoteBreakdown,
};
