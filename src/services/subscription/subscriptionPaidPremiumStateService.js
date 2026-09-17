"use strict";

const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const Payment = require("../../models/Payment");

const PAID_PREMIUM_SOURCES = new Set(["paid", "paid_extra"]);

function clean(value) {
  if (value === undefined || value === null) return "";
  try {
    if (value && typeof value === "object" && typeof value.toHexString === "function") {
      return String(value.toHexString()).trim();
    }
    return String(value).trim();
  } catch (_error) {
    return "";
  }
}

function plain(value) {
  if (!value || typeof value !== "object") return value || {};
  return typeof value.toObject === "function"
    ? value.toObject({ depopulate: false })
    : value;
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function slotKeyOf(slot, index = 0) {
  return clean(slot && (slot.slotKey || (slot.slotIndex ? `slot_${slot.slotIndex}` : "")))
    || `slot_${index + 1}`;
}

function normalizedPremiumSource(value) {
  const source = clean(value).toLowerCase();
  if (source === "paid") return "paid";
  if (source === "paid_extra") return "paid_extra";
  if (source === "balance") return "balance";
  if (source === "pending_payment") return "pending_payment";
  return "none";
}

function isPaidPremiumSource(value) {
  return PAID_PREMIUM_SOURCES.has(normalizedPremiumSource(value));
}

function premiumIdentity(slot = {}) {
  const source = plain(slot);
  const selectionType = clean(source.selectionType);
  const premiumKey = clean(source.premiumKey || source.sourceKey || source.proteinKey).toLowerCase();
  const proteinId = clean(source.proteinId);
  const productId = clean(source.productId || source.sandwichId);
  const saladProtein = source.salad && source.salad.groups && Array.isArray(source.salad.groups.protein)
    ? clean(source.salad.groups.protein[0])
    : "";
  return {
    selectionType,
    premiumKey,
    proteinId,
    productId,
    saladProtein,
  };
}

function samePaidPremiumIdentity(existingSlot, incomingSlot) {
  if (!existingSlot || !incomingSlot) return false;
  if (!isPaidPremiumSource(existingSlot.premiumSource)) return false;
  const existing = premiumIdentity(existingSlot);
  const incoming = premiumIdentity(incomingSlot);
  if (!existing.selectionType || existing.selectionType !== incoming.selectionType) return false;

  if (existing.premiumKey && incoming.premiumKey) {
    if (existing.premiumKey !== incoming.premiumKey) return false;
  } else if (existing.premiumKey || incoming.premiumKey) {
    const sameProtein = existing.proteinId && incoming.proteinId && existing.proteinId === incoming.proteinId;
    const sameProduct = existing.productId && incoming.productId && existing.productId === incoming.productId;
    const sameSaladProtein = existing.saladProtein && incoming.saladProtein && existing.saladProtein === incoming.saladProtein;
    if (!sameProtein && !sameProduct && !sameSaladProtein) return false;
  }

  if (existing.proteinId && incoming.proteinId && existing.proteinId !== incoming.proteinId) return false;
  if (existing.productId && incoming.productId && existing.productId !== incoming.productId) return false;
  if (existing.saladProtein && incoming.saladProtein && existing.saladProtein !== incoming.saladProtein) return false;
  return true;
}

function preservePaidPremiumSlots(existingDay, incomingMealSlots) {
  const incoming = Array.isArray(incomingMealSlots) ? incomingMealSlots : incomingMealSlots;
  if (!Array.isArray(incoming)) return incoming;
  const existingSlots = Array.isArray(existingDay && existingDay.mealSlots)
    ? existingDay.mealSlots.map(plain)
    : [];
  const existingBySlotKey = new Map(existingSlots.map((slot, index) => [slotKeyOf(slot, index), slot]));

  return incoming.map((rawSlot, index) => {
    const slot = plain(rawSlot);
    const existing = existingBySlotKey.get(slotKeyOf(slot, index));
    if (!samePaidPremiumIdentity(existing, slot)) return rawSlot;
    return {
      ...slot,
      isPremium: true,
      premiumKey: existing.premiumKey || slot.premiumKey || null,
      premiumSource: normalizedPremiumSource(existing.premiumSource) === "paid" ? "paid" : "paid_extra",
      premiumExtraFeeHalala: Number(existing.premiumExtraFeeHalala || slot.premiumExtraFeeHalala || 0),
    };
  });
}

function paidSelectionSource(selection, slot) {
  const source = normalizedPremiumSource(
    selection && selection.premiumSource
      ? selection.premiumSource
      : slot && slot.premiumSource
  );
  if (source === "balance") return "subscription";
  if (isPaidPremiumSource(source)) return "paid";
  return clean(selection && selection.source) || "";
}

function synchronizeDayPremiumSelections(day, payment) {
  const paidAt = payment && payment.paidAt ? payment.paidAt : new Date();
  const paymentId = payment && payment._id ? payment._id : null;
  const slots = Array.isArray(day && day.mealSlots) ? day.mealSlots.map(plain) : [];
  const slotByKey = new Map(slots.map((slot, index) => [slotKeyOf(slot, index), slot]));
  const selections = Array.isArray(day && day.premiumUpgradeSelections)
    ? day.premiumUpgradeSelections.map(plain)
    : [];

  return selections.map((selection) => {
    const slot = slotByKey.get(clean(selection.baseSlotKey || selection.slotKey)) || null;
    const slotSource = normalizedPremiumSource(slot && slot.premiumSource);
    const selectionSource = normalizedPremiumSource(selection.premiumSource);
    const effectiveSource = slotSource !== "none" ? slotSource : selectionSource;
    const isPaid = isPaidPremiumSource(effectiveSource);
    const isBalance = effectiveSource === "balance";
    return {
      ...selection,
      premiumSource: isPaid ? (effectiveSource === "paid" ? "paid" : "paid_extra") : (isBalance ? "balance" : effectiveSource),
      source: isPaid ? "paid" : (isBalance ? "subscription" : paidSelectionSource(selection, slot)),
      paymentId: isPaid ? (paymentId || selection.paymentId || null) : (selection.paymentId || null),
      paidAt: isPaid ? (selection.paidAt || paidAt) : (selection.paidAt || null),
      consumedAt: selection.consumedAt || paidAt,
    };
  });
}

function parentPremiumSelectionRow(selection, day) {
  const source = plain(selection);
  return {
    dayId: day._id,
    date: day.date,
    baseSlotKey: source.baseSlotKey,
    premiumKey: source.premiumKey,
    configId: source.configId || null,
    revision: Number(source.revision || 0),
    kind: source.kind || "",
    entityType: source.entityType || "",
    selectionType: source.selectionType || "",
    sourceType: source.sourceType || "",
    sourceModel: source.sourceModel || "",
    sourceId: source.sourceId || "",
    sourceProductId: source.sourceProductId || "",
    sourceGroupId: source.sourceGroupId || "",
    sourceGroupKey: source.sourceGroupKey || "",
    sourceKey: source.sourceKey || "",
    name: source.name || "",
    nameI18n: source.nameI18n || undefined,
    imageUrl: source.imageUrl || "",
    proteinId: source.proteinId || null,
    quantity: Math.max(1, Number(source.quantity || 1)),
    coveredQty: Math.max(0, Number(source.coveredQty || (source.source === "subscription" ? 1 : 0))),
    paidQty: Math.max(0, Number(source.paidQty || (source.source === "subscription" ? 0 : 1))),
    unitExtraFeeHalala: Math.max(0, Number(source.unitExtraFeeHalala || 0)),
    payableTotalHalala: Math.max(0, Number(source.payableTotalHalala || 0)),
    currency: source.currency || "SAR",
    balanceBucketId: source.balanceBucketId || null,
    premiumWalletRowId: source.premiumWalletRowId || source.balanceBucketId || null,
    source: source.source || paidSelectionSource(source),
    paymentId: source.paymentId || null,
    consumedAt: source.consumedAt || new Date(),
    paidAt: source.paidAt || null,
  };
}

async function synchronizePaidPremiumState({
  subscriptionId,
  dayId,
  payment,
  session = null,
} = {}) {
  if (!subscriptionId || !dayId || !payment || clean(payment.status) !== "paid") {
    return { synchronized: false, reason: "paid_payment_context_required" };
  }

  let dayQuery = SubscriptionDay.findOne({ _id: dayId, subscriptionId });
  if (session) dayQuery = dayQuery.session(session);
  const day = await dayQuery;
  if (!day) {
    const error = new Error("Subscription day not found while synchronizing paid Premium state");
    error.code = "DAY_NOT_FOUND";
    error.status = 404;
    throw error;
  }

  const daySelections = synchronizeDayPremiumSelections(day, payment);
  day.premiumUpgradeSelections = daySelections;
  if (day.premiumExtraPayment) {
    day.premiumExtraPayment.status = "paid";
    day.premiumExtraPayment.paymentId = payment._id;
    day.premiumExtraPayment.providerInvoiceId = payment.providerInvoiceId || day.premiumExtraPayment.providerInvoiceId || null;
    day.premiumExtraPayment.paidAt = payment.paidAt || day.premiumExtraPayment.paidAt || new Date();
  }
  day.markModified("premiumUpgradeSelections");
  day.markModified("premiumExtraPayment");
  await day.save(session ? { session } : undefined);

  let subscriptionQuery = Subscription.findById(subscriptionId);
  if (session) subscriptionQuery = subscriptionQuery.session(session);
  const subscription = await subscriptionQuery;
  if (!subscription) {
    const error = new Error("Subscription not found while synchronizing paid Premium state");
    error.code = "SUBSCRIPTION_NOT_FOUND";
    error.status = 404;
    throw error;
  }

  const retained = (Array.isArray(subscription.premiumSelections) ? subscription.premiumSelections : [])
    .filter((selection) => (
      clean(selection && selection.dayId) !== clean(day._id)
        && clean(selection && selection.date) !== clean(day.date)
    ));
  subscription.premiumSelections = [
    ...retained.map(plain),
    ...daySelections.map((selection) => parentPremiumSelectionRow(selection, day)),
  ];
  subscription.markModified("premiumSelections");
  await subscription.save(session ? { session } : undefined);

  return {
    synchronized: true,
    dayId: clean(day._id),
    paymentId: clean(payment._id),
    paidPremiumSelectionCount: daySelections.filter((selection) => selection.source === "paid").length,
    premiumSelectionCount: daySelections.length,
  };
}

function createPaidPremiumSettlementWrapper(originalSettlement) {
  if (typeof originalSettlement !== "function") {
    throw new TypeError("originalSettlement is required");
  }
  async function settlePaidPremiumExtraDayPaymentWithSynchronization(args = {}) {
    const result = await originalSettlement(args);
    if (result && result.applied && args.subscription && args.day && args.payment) {
      const sync = await synchronizePaidPremiumState({
        subscriptionId: args.subscription._id || args.subscription,
        dayId: args.day._id || args.day,
        payment: args.payment,
        session: args.session || null,
      });
      return { ...result, premiumStateSynchronization: sync };
    }
    return result;
  }
  Object.defineProperty(settlePaidPremiumExtraDayPaymentWithSynchronization, "__paidPremiumStateSynchronized", { value: true });
  Object.defineProperty(settlePaidPremiumExtraDayPaymentWithSynchronization, "__original", { value: originalSettlement });
  return settlePaidPremiumExtraDayPaymentWithSynchronization;
}

function createPaidPremiumSelectionOperationWrapper(originalOperation) {
  if (typeof originalOperation !== "function") throw new TypeError("originalOperation is required");
  async function paidPremiumSelectionOperation(args = {}) {
    if (!args.subscriptionId || !args.date || !Array.isArray(args.mealSlots)) {
      return originalOperation(args);
    }
    const existingDay = await SubscriptionDay.findOne({
      subscriptionId: args.subscriptionId,
      date: args.date,
    }).lean();
    return originalOperation({
      ...args,
      mealSlots: preservePaidPremiumSlots(existingDay, args.mealSlots),
    });
  }
  Object.defineProperty(paidPremiumSelectionOperation, "__preservesPaidPremiumState", { value: true });
  Object.defineProperty(paidPremiumSelectionOperation, "__original", { value: originalOperation });
  return paidPremiumSelectionOperation;
}

function createPaidPremiumBulkSelectionWrapper(originalOperation) {
  if (typeof originalOperation !== "function") throw new TypeError("originalOperation is required");
  async function paidPremiumBulkSelectionOperation(args = {}) {
    const requests = Array.isArray(args.requests) ? args.requests : [];
    if (!args.subscriptionId || !requests.length) return originalOperation(args);
    const dates = requests.map((row) => clean(row && row.date)).filter(Boolean);
    const days = await SubscriptionDay.find({
      subscriptionId: args.subscriptionId,
      date: { $in: dates },
    }).lean();
    const byDate = new Map(days.map((day) => [clean(day.date), day]));
    return originalOperation({
      ...args,
      requests: requests.map((row) => ({
        ...row,
        mealSlots: preservePaidPremiumSlots(byDate.get(clean(row && row.date)), row && row.mealSlots),
      })),
    });
  }
  Object.defineProperty(paidPremiumBulkSelectionOperation, "__preservesPaidPremiumState", { value: true });
  Object.defineProperty(paidPremiumBulkSelectionOperation, "__original", { value: originalOperation });
  return paidPremiumBulkSelectionOperation;
}

async function synchronizePaidPremiumStateFromPaymentId({ subscriptionId, dayId, paymentId, session = null } = {}) {
  let paymentQuery = Payment.findOne({ _id: paymentId, subscriptionId, status: "paid" });
  if (session) paymentQuery = paymentQuery.session(session);
  const payment = await paymentQuery;
  if (!payment) return { synchronized: false, reason: "paid_payment_not_found" };
  return synchronizePaidPremiumState({ subscriptionId, dayId, payment, session });
}

module.exports = {
  PAID_PREMIUM_SOURCES,
  createPaidPremiumBulkSelectionWrapper,
  createPaidPremiumSelectionOperationWrapper,
  createPaidPremiumSettlementWrapper,
  isPaidPremiumSource,
  parentPremiumSelectionRow,
  preservePaidPremiumSlots,
  samePaidPremiumIdentity,
  synchronizeDayPremiumSelections,
  synchronizePaidPremiumState,
  synchronizePaidPremiumStateFromPaymentId,
};
