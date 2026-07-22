"use strict";

const Addon = require("../models/Addon");
const Subscription = require("../models/Subscription");
const SubscriptionDay = require("../models/SubscriptionDay");
const { getPaymentMetadata } = require("./subscription/subscriptionCheckoutHelpers");
const { buildErrorResult } = require("./subscription/subscriptionNonCheckoutPaymentService");

const INSTALL_KEY = Symbol.for("basicdiet.subscriptionAddonPaymentBoundaryGuard.installed");
const WRAPPED_KEY = Symbol.for("basicdiet.subscriptionAddonPaymentBoundaryGuard.wrapped");
const SYSTEM_CURRENCY = "SAR";
const GUARDED_DAY_PAYMENT_TYPES = new Set([
  "day_planning_payment",
  "one_time_addon_day_planning",
]);

function clean(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && Number.isInteger(parsed) && parsed > 0
    ? parsed
    : 0;
}

function normalizeCurrency(value) {
  return clean(value || SYSTEM_CURRENCY).toUpperCase();
}

function resolvePendingAddonPayableHalala(selection = {}) {
  const explicitTotal = positiveInteger(selection.payableTotalHalala);
  if (explicitTotal > 0) return explicitTotal;

  const storedTotal = positiveInteger(selection.priceHalala);
  if (storedTotal > 0) return storedTotal;

  // A unit/reference price is useful for display, but it is not enough to
  // reconstruct a payable invoice safely after the persisted total was lost.
  // Fail closed so stale or corrupted rows cannot become a free add-on.
  return 0;
}

function buildInvalidAddonPriceResult(selection = {}, index = null) {
  const addonId = clean(
    selection.addonId
      || selection.productId
      || selection.menuProductId
      || selection.id
  );
  return buildErrorResult(
    422,
    "INVALID_ADDON_PRICE",
    "Add-on payment requires a positive authoritative price",
    {
      addonId: addonId || null,
      addonSelectionId: clean(selection._id || selection.addonSelectionId) || null,
      addonPlanId: clean(selection.addonPlanId) || null,
      selectionIndex: Number.isInteger(index) ? index : null,
      field: "priceHalala",
    }
  );
}

function inspectPendingAddonSelections(day = {}) {
  const pending = (Array.isArray(day && day.addonSelections) ? day.addonSelections : [])
    .filter((selection) => selection && selection.source === "pending_payment");
  const pricedItems = [];

  for (let index = 0; index < pending.length; index += 1) {
    const selection = pending[index];
    const amountHalala = resolvePendingAddonPayableHalala(selection);
    if (amountHalala <= 0 || normalizeCurrency(selection.currency) !== SYSTEM_CURRENCY) {
      return {
        valid: false,
        error: buildInvalidAddonPriceResult(selection, index),
        pendingCount: pending.length,
        totalHalala: 0,
        pricedItems: [],
      };
    }
    pricedItems.push({
      addonSelectionId: clean(selection._id || selection.addonSelectionId) || null,
      addonId: clean(selection.addonId || selection.productId || selection.menuProductId),
      priceHalala: amountHalala,
      currency: SYSTEM_CURRENCY,
    });
  }

  return {
    valid: true,
    error: null,
    pendingCount: pending.length,
    totalHalala: pricedItems.reduce((sum, item) => sum + item.priceHalala, 0),
    pricedItems,
  };
}

function resolveLegacyAddonAmountHalala(addon = {}) {
  const direct = positiveInteger(addon.priceHalala);
  if (direct > 0) return direct;
  const legacyPrice = Number(addon.price);
  if (!Number.isFinite(legacyPrice) || legacyPrice <= 0) return 0;
  return positiveInteger(Math.round(legacyPrice * 100));
}

function guardedInvoiceRuntime(runtime = {}) {
  if (!runtime || typeof runtime.createInvoice !== "function") return runtime;
  const originalCreateInvoice = runtime.createInvoice;
  return {
    ...runtime,
    async createInvoice(payload = {}) {
      if (positiveInteger(payload.amount) <= 0) {
        const err = new Error("Payment provider invoice amount must be a positive integer");
        err.status = 422;
        err.code = "INVALID_ADDON_PRICE";
        throw err;
      }
      return originalCreateInvoice(payload);
    },
  };
}

async function loadOwnedPaymentContext({ subscriptionId, userId, date }) {
  if (!subscriptionId || !userId) return { subscription: null, day: null };
  const subscription = await Subscription.findOne({
    _id: subscriptionId,
    userId,
  }).lean();
  if (!subscription) return { subscription: null, day: null };
  const day = date
    ? await SubscriptionDay.findOne({ subscriptionId: subscription._id, date }).lean()
    : null;
  return { subscription, day };
}

function wrapExport(target, name, factory) {
  const original = target && target[name];
  if (typeof original !== "function" || original[WRAPPED_KEY]) return original;
  const wrapped = factory(original);
  Object.defineProperty(wrapped, WRAPPED_KEY, { value: true });
  Object.defineProperty(wrapped, "__original", { value: original });
  Object.defineProperty(wrapped, "__addonPaymentBoundaryGuard", { value: true });
  target[name] = wrapped;
  return wrapped;
}

function patchDayPaymentInitiation(service, exportName) {
  wrapExport(service, exportName, (original) => async function guardedDayPaymentInitiation(args = {}) {
    const context = await loadOwnedPaymentContext(args);
    if (context.subscription && context.day) {
      const inspection = inspectPendingAddonSelections(context.day);
      if (!inspection.valid) return inspection.error;
    }
    return original({
      ...args,
      runtime: guardedInvoiceRuntime(args.runtime),
    });
  });
}

function patchLegacyAddonInitiation(service) {
  wrapExport(service, "createLegacyOneTimeAddonPaymentFlow", (original) => async function guardedLegacyAddonInitiation(args = {}) {
    const context = await loadOwnedPaymentContext(args);
    if (context.subscription && args.addonId) {
      const addon = await Addon.findById(args.addonId).lean();
      if (addon && resolveLegacyAddonAmountHalala(addon) <= 0) {
        return buildInvalidAddonPriceResult({
          addonId: addon._id,
          addonPlanId: addon.addonPlanId || null,
        });
      }
    }
    return original({
      ...args,
      runtime: guardedInvoiceRuntime(args.runtime),
    });
  });
}

function inspectPaymentApplicationPrice(payment = {}) {
  const type = clean(payment.type);
  const metadata = getPaymentMetadata(payment);

  if (type === "one_time_addon") {
    return positiveInteger(payment.amount) > 0
      ? { valid: true }
      : { valid: false, reason: "invalid_addon_price" };
  }

  if (!GUARDED_DAY_PAYMENT_TYPES.has(type)) return { valid: true };
  const selections = Array.isArray(metadata.oneTimeAddonSelections)
    ? metadata.oneTimeAddonSelections
    : [];
  if (selections.length === 0) return { valid: true };

  const inspection = inspectPendingAddonSelections({
    addonSelections: selections.map((selection) => ({
      ...selection,
      source: "pending_payment",
    })),
  });
  if (!inspection.valid || inspection.totalHalala <= 0) {
    return { valid: false, reason: "invalid_addon_price" };
  }

  const metadataAddonAmount = metadata.addonsAmountHalala;
  if (
    metadataAddonAmount !== undefined
    && metadataAddonAmount !== null
    && Number(metadataAddonAmount) !== inspection.totalHalala
  ) {
    return { valid: false, reason: "addon_payment_amount_mismatch" };
  }

  if (positiveInteger(payment.amount) < inspection.totalHalala) {
    return { valid: false, reason: "addon_payment_amount_mismatch" };
  }

  return {
    valid: true,
    addonAmountHalala: inspection.totalHalala,
  };
}

function patchPaymentApplicationBoundary() {
  const paymentApplication = require("./paymentApplicationService");
  wrapExport(paymentApplication, "applyPaymentSideEffects", (original) => async function guardedPaymentApplication(args = {}, runtimeOverrides = null) {
    const inspection = inspectPaymentApplicationPrice(args.payment || {});
    if (!inspection.valid) {
      return {
        applied: false,
        reason: inspection.reason,
      };
    }
    return original(args, runtimeOverrides);
  });
}

function installSubscriptionAddonPaymentBoundaryGuard() {
  if (globalThis[INSTALL_KEY]) return globalThis[INSTALL_KEY];

  const oneTimePlanning = require("./subscription/oneTimeAddonDayPlanningPaymentService");
  const unifiedDayPayment = require("./subscription/unifiedDayPaymentService");
  const legacyAddonPayment = require("./subscription/legacyOneTimeAddonPaymentService");

  patchDayPaymentInitiation(oneTimePlanning, "createOneTimeAddonDayPlanningPaymentFlow");
  patchDayPaymentInitiation(unifiedDayPayment, "createUnifiedDayPaymentFlow");
  patchLegacyAddonInitiation(legacyAddonPayment);
  patchPaymentApplicationBoundary();

  const state = Object.freeze({
    installed: true,
    installedAt: new Date(),
    zeroAmountInvoiceBlocked: true,
    zeroAmountSettlementBlocked: true,
    flutterRepositoryChanged: false,
  });
  globalThis[INSTALL_KEY] = state;
  return state;
}

installSubscriptionAddonPaymentBoundaryGuard();

module.exports = {
  GUARDED_DAY_PAYMENT_TYPES,
  INSTALL_KEY,
  SYSTEM_CURRENCY,
  buildInvalidAddonPriceResult,
  guardedInvoiceRuntime,
  inspectPaymentApplicationPrice,
  inspectPendingAddonSelections,
  installSubscriptionAddonPaymentBoundaryGuard,
  resolveLegacyAddonAmountHalala,
  resolvePendingAddonPayableHalala,
};
