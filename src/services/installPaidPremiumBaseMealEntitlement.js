"use strict";

const mongoose = require("mongoose");
const { startSafeSession } = require("../utils/mongoTransactionSupport");
const Subscription = require("../models/Subscription");
const SubscriptionDay = require("../models/SubscriptionDay");
const Payment = require("../models/Payment");
const premiumPaymentService = require("./subscription/premiumExtraDayPaymentService");
const entitlementService = require("./subscription/subscriptionMealEntitlementService");

const INSTALL_KEY = Symbol.for("basicdiet.paidPremiumBaseMealEntitlement.installed");
const SETTLEMENT_WRAPPED_KEY = Symbol.for("basicdiet.paidPremiumBaseMealEntitlement.settlementWrapped");
const VERIFY_WRAPPED_KEY = Symbol.for("basicdiet.paidPremiumBaseMealEntitlement.verifyWrapped");

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function plain(value) {
  if (!value || typeof value !== "object") return value || {};
  return typeof value.toObject === "function"
    ? value.toObject({ depopulate: false, getters: false, virtuals: false })
    : value;
}

function completeMealSlots(day) {
  return (Array.isArray(day && day.mealSlots) ? day.mealSlots : []).filter(
    (slot) => slot && String(slot.status || "complete") === "complete"
  );
}

function dataIntegrityError(message, details = undefined) {
  const error = new Error(message);
  error.code = "DATA_INTEGRITY_ERROR";
  error.status = 409;
  if (details !== undefined) error.details = details;
  return error;
}

function copyFunctionMetadata(source, target) {
  for (const key of Reflect.ownKeys(source)) {
    if (["length", "name", "prototype", "arguments", "caller", "__original"].includes(key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (!descriptor) continue;
    try {
      Object.defineProperty(target, key, descriptor);
    } catch (_error) {
      // Compatibility metadata must never block startup.
    }
  }
  return target;
}

async function ensurePaidPremiumBaseMealEntitlement({
  subscription,
  day,
  payment = null,
  session = null,
  reserveDayEntitlementsFn = null,
} = {}) {
  const subscriptionId = clean(subscription && (subscription._id || subscription.id || subscription));
  const sourceDay = plain(day);
  const dayId = clean(sourceDay && sourceDay._id);
  const slots = completeMealSlots(sourceDay);

  if (!subscriptionId) {
    throw dataIntegrityError("Paid Premium settlement has no subscription identity");
  }
  if (!dayId) {
    throw dataIntegrityError("Paid Premium settlement has no persisted subscription day");
  }
  if (slots.length === 0) {
    throw dataIntegrityError("Paid Premium settlement has no complete base meal slots", {
      subscriptionId,
      dayId,
      date: clean(sourceDay.date),
    });
  }

  const reserve = reserveDayEntitlementsFn
    || entitlementService.reserveDayEntitlements;
  if (typeof reserve !== "function") {
    throw dataIntegrityError("Base meal entitlement reservation service is unavailable");
  }

  const reservation = await reserve({
    subscriptionId,
    day,
    paymentId: payment && payment._id ? payment._id : null,
    session,
  });
  const allocationKeys = [...new Set((Array.isArray(reservation && reservation.allocationKeys)
    ? reservation.allocationKeys
    : []).map(clean).filter(Boolean))];

  if (allocationKeys.length !== slots.length) {
    throw dataIntegrityError("Paid Premium settlement did not resolve one base meal allocation per complete slot", {
      subscriptionId,
      dayId,
      date: clean(sourceDay.date),
      expectedAllocationCount: slots.length,
      actualAllocationCount: allocationKeys.length,
    });
  }

  let query = Subscription.findById(subscriptionId)
    .select("totalMeals remainingMeals reservedMeals consumedMeals forfeitedMeals baseMealAllocations");
  if (session) query = query.session(session);
  const refreshed = await query.lean();
  if (!refreshed) {
    throw dataIntegrityError("Subscription disappeared after paid Premium base meal reservation", {
      subscriptionId,
      dayId,
    });
  }

  const activeKeys = new Set(
    (Array.isArray(refreshed.baseMealAllocations) ? refreshed.baseMealAllocations : [])
      .filter((allocation) => ["reserved", "consumed", "forfeited"].includes(clean(allocation && allocation.state)))
      .map((allocation) => clean(allocation && allocation.allocationKey))
      .filter(Boolean)
  );
  const missingKeys = allocationKeys.filter((key) => !activeKeys.has(key));
  if (missingKeys.length) {
    throw dataIntegrityError("Paid Premium base meal allocations are not active after reservation", {
      subscriptionId,
      dayId,
      missingAllocationKeys: missingKeys,
    });
  }

  return {
    allocationKeys,
    newlyReservedKeys: [...new Set((Array.isArray(reservation && reservation.newlyReservedKeys)
      ? reservation.newlyReservedKeys
      : []).map(clean).filter(Boolean))],
    expectedMealCredits: slots.length,
    remainingMeals: Number(refreshed.remainingMeals || 0),
    reservedMeals: Number(refreshed.reservedMeals || 0),
    consumedMeals: Number(refreshed.consumedMeals || 0),
  };
}

function installSettlementGuard() {
  const original = premiumPaymentService.settlePaidPremiumExtraDayPayment;
  if (typeof original !== "function") {
    throw new Error("premiumExtraDayPaymentService.settlePaidPremiumExtraDayPayment is missing");
  }
  if (original[SETTLEMENT_WRAPPED_KEY] === true) return original;

  const wrapped = async function settlePaidPremiumExtraDayPaymentWithBaseMealEntitlement(args = {}) {
    const result = await original(args);
    if (!result || result.applied !== true) return result;

    const baseMealReservation = await ensurePaidPremiumBaseMealEntitlement({
      subscription: args.subscription,
      day: args.day,
      payment: args.payment,
      session: args.session || null,
    });

    return {
      ...result,
      baseMealReservation,
    };
  };

  copyFunctionMetadata(original, wrapped);
  Object.defineProperty(wrapped, SETTLEMENT_WRAPPED_KEY, { value: true });
  Object.defineProperty(wrapped, "__paidPremiumBaseMealEntitlement", {
    value: true,
    configurable: true,
  });
  Object.defineProperty(wrapped, "__original", {
    value: original,
    configurable: true,
  });
  premiumPaymentService.settlePaidPremiumExtraDayPayment = wrapped;
  return wrapped;
}

async function reconcileSuccessfulLegacyVerify(args, result) {
  if (!result || result.ok !== true || !args || !args.paymentId) return result;

  const payment = await Payment.findOne({
    _id: args.paymentId,
    subscriptionId: args.subscriptionId,
    userId: args.userId,
    type: "premium_extra_day",
    status: "paid",
    applied: true,
  }).lean();
  if (!payment) return result;

  const session = await startSafeSession();
  try {
    session.startTransaction();
    const [subscription, day] = await Promise.all([
      Subscription.findById(args.subscriptionId).session(session),
      SubscriptionDay.findOne({ subscriptionId: args.subscriptionId, date: args.date }).session(session),
    ]);
    if (!subscription || !day) {
      throw dataIntegrityError("Paid legacy Premium verification cannot resolve its subscription day", {
        subscriptionId: clean(args.subscriptionId),
        date: clean(args.date),
        paymentId: clean(args.paymentId),
      });
    }

    const baseMealReservation = await ensurePaidPremiumBaseMealEntitlement({
      subscription,
      day,
      payment,
      session,
    });
    await session.commitTransaction();
    return {
      ...result,
      data: result.data && typeof result.data === "object"
        ? { ...result.data, baseMealReservation }
        : result.data,
    };
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}

function installLegacyVerifyGuard() {
  const original = premiumPaymentService.verifyPremiumExtraDayPaymentFlow;
  if (typeof original !== "function") {
    throw new Error("premiumExtraDayPaymentService.verifyPremiumExtraDayPaymentFlow is missing");
  }
  if (original[VERIFY_WRAPPED_KEY] === true) return original;

  const wrapped = async function verifyPremiumExtraDayPaymentWithBaseMealEntitlement(args = {}) {
    const result = await original(args);
    return reconcileSuccessfulLegacyVerify(args, result);
  };

  copyFunctionMetadata(original, wrapped);
  Object.defineProperty(wrapped, VERIFY_WRAPPED_KEY, { value: true });
  Object.defineProperty(wrapped, "__paidPremiumBaseMealEntitlement", {
    value: true,
    configurable: true,
  });
  Object.defineProperty(wrapped, "__original", {
    value: original,
    configurable: true,
  });
  premiumPaymentService.verifyPremiumExtraDayPaymentFlow = wrapped;
  return wrapped;
}

function installPaidPremiumBaseMealEntitlement() {
  if (globalThis[INSTALL_KEY]) return globalThis[INSTALL_KEY];

  const settlement = installSettlementGuard();
  const legacyVerify = installLegacyVerifyGuard();
  const state = Object.freeze({
    installed: true,
    installedAt: new Date(),
    settlementGuarded: settlement.__paidPremiumBaseMealEntitlement === true,
    legacyVerifyGuarded: legacyVerify.__paidPremiumBaseMealEntitlement === true,
  });
  globalThis[INSTALL_KEY] = state;
  return state;
}

installPaidPremiumBaseMealEntitlement();

module.exports = {
  INSTALL_KEY,
  SETTLEMENT_WRAPPED_KEY,
  VERIFY_WRAPPED_KEY,
  completeMealSlots,
  ensurePaidPremiumBaseMealEntitlement,
  installPaidPremiumBaseMealEntitlement,
  reconcileSuccessfulLegacyVerify,
};
