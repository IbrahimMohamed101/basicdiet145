"use strict";

const ActivityLog = require("../../models/ActivityLog");
const SubscriptionPickupRequest = require("../../models/SubscriptionPickupRequest");

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function integer(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function optionalInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : null;
}

function localized(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  const object = asObject(value);
  for (const candidate of [
    object.ar,
    object.en,
    object.name,
    object.title,
    object.label,
    object.displayName,
  ]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "";
}

function snapshotName(slot = {}) {
  for (const snapshot of [
    slot.displaySnapshot,
    slot.confirmationSnapshot,
    slot.fulfillmentSnapshot,
    slot.pricingSnapshot,
  ]) {
    const object = asObject(snapshot);
    const name = localized(
      object.name
        || object.nameI18n
        || object.productName
        || object.title
        || object.label
    );
    if (name) return name;
  }
  return localized(slot.name || slot.nameI18n || asObject(slot.product).name)
    || String(slot.productKey || slot.premiumKey || slot.slotKey || "وجبة");
}

function snapshotMealItem(slot = {}, index = 0) {
  const carbs = asArray(slot.carbs || slot.carbSelections).map((carb) => ({
    id: carb && carb.carbId ? String(carb.carbId) : null,
    name: localized(carb && (carb.name || carb.nameI18n)) || "نشويات",
    grams: carb && carb.grams !== undefined ? integer(carb.grams) : null,
  }));
  const selectionType = String(slot.selectionType || slot.itemType || "standard_meal");
  const typeLabels = {
    standard_meal: "وجبة عادية",
    premium_meal: "وجبة مميزة",
    premium_large_salad: "سلطة مميزة كبيرة",
    large_salad: "سلطة مميزة كبيرة",
    sandwich: "ساندويتش",
  };
  const proteinName = localized(slot.proteinName || asObject(slot.protein).name);
  return {
    id: String(slot.slotKey || slot.itemId || slot.id || `pickup-item-${index + 1}`),
    slotIndex: integer(slot.slotIndex) || index + 1,
    slotKey: String(slot.slotKey || slot.itemId || `slot_${index + 1}`),
    name: snapshotName(slot),
    type: selectionType,
    typeLabel: typeLabels[selectionType] || "وجبة",
    quantity: Math.max(1, integer(slot.quantity || slot.qty || 1)),
    isPremium: Boolean(slot.isPremium) || selectionType.includes("premium") || selectionType === "large_salad",
    premiumKey: slot.premiumKey || null,
    protein: proteinName
      ? { id: slot.proteinId ? String(slot.proteinId) : null, name: proteinName }
      : null,
    carbs,
  };
}

function pickupSnapshotItems(request = {}) {
  const snapshot = asObject(request.snapshot);
  const slots = asArray(snapshot.mealSlots);
  if (slots.length) return slots.map(snapshotMealItem);

  const selectedItems = asArray(request.selectedPickupItems)
    .filter((item) => item && ["meal", "premium_meal", "large_salad", "sandwich"].includes(String(item.itemType || "")));
  return selectedItems.map((item, index) => snapshotMealItem({
    ...item,
    name: item.name || item.title || item.displayName || asObject(item.product).name,
    selectionType: item.itemType,
    slotKey: item.slotKey || item.sourceId || item.itemId,
  }, index));
}

function reasonLabel(reason) {
  const code = String(reason || "").trim().toLowerCase();
  const labels = {
    cashier_walk_in: "صرف مباشر للعميل من الفرع",
    customer_walk_in: "صرف مباشر للعميل من الفرع",
    walk_in: "صرف مباشر للعميل من الفرع",
    manual_adjustment: "تسوية يدوية للرصيد",
    balance_correction: "تصحيح رصيد الاشتراك",
    complimentary_meal: "وجبة مجانية مع خصمها من الرصيد",
    replacement_meal: "وجبة بديلة",
    admin_adjustment: "تعديل إداري للرصيد",
  };
  return labels[code] || (code ? code.replace(/_/g, " ") : "لم يُسجل سبب واضح");
}

function manualDeductionDetails(log = {}) {
  const meta = asObject(log.meta);
  const before = asObject(meta.before);
  const after = asObject(meta.after);
  const reasonCode = String(meta.reason || "").trim();
  const fulfillmentMethod = String(meta.fulfillmentMethod || "").trim().toLowerCase() || null;
  return {
    regularMeals: integer(meta.deductedRegularMeals),
    premiumMeals: integer(meta.deductedPremiumMeals),
    totalMeals: integer(meta.deductedTotalMeals),
    addons: asArray(meta.deductedAddons).map((addon) => ({
      addonId: addon && addon.addonId ? String(addon.addonId) : null,
      qty: integer(addon && addon.qty),
      remainingBefore: optionalInteger(addon && addon.remainingBefore),
      remainingAfter: optionalInteger(addon && addon.remainingAfter),
    })),
    before: {
      remainingRegularMeals: optionalInteger(before.remainingRegularMeals),
      remainingPremiumMeals: optionalInteger(before.remainingPremiumMeals),
      remainingMeals: optionalInteger(before.remainingMeals),
    },
    after: {
      remainingRegularMeals: optionalInteger(after.remainingRegularMeals),
      remainingPremiumMeals: optionalInteger(after.remainingPremiumMeals),
      remainingMeals: optionalInteger(after.remainingMeals),
    },
    reasonCode,
    reasonLabel: reasonLabel(reasonCode),
    notes: String(meta.notes || ""),
    businessDate: meta.businessDate || null,
    fulfillmentContext: fulfillmentMethod
      ? {
          code: fulfillmentMethod,
          label: fulfillmentMethod === "pickup"
            ? "تم تسجيل الخصم أثناء صرف مباشر من الفرع"
            : "تم تسجيل الخصم ضمن اشتراك توصيل",
        }
      : { code: "unspecified", label: "لم يُسجل سياق تنفيذ" },
  };
}

function correctedSource(movement) {
  if (movement.balanceEffect === "forfeited") {
    return {
      sourceCode: "forfeited_entitlement",
      sourceLabel: "مصادرة رصيد وفق الحالة التشغيلية",
      completion: { code: "forfeiture", label: "مصادرة" },
    };
  }
  if (movement.status === "no_show") {
    return {
      sourceCode: "pickup_no_show_consumption",
      sourceLabel: "حسم بعد عدم حضور العميل للاستلام",
      completion: { code: "no_show", label: "لم يحضر العميل" },
    };
  }
  if (["delivery_canceled", "canceled_at_branch", "canceled", "cancelled"].includes(String(movement.status || ""))) {
    return {
      sourceCode: "canceled_operation_consumption",
      sourceLabel: "حسم مرتبط بعملية ملغاة",
      completion: { code: "canceled", label: "عملية ملغاة" },
    };
  }
  return null;
}

function recalculateCoverage(movements, balanceConsumedMeals) {
  const consumed = movements.filter((movement) => movement.balanceEffect === "consumed");
  const representedMeals = consumed.reduce((sum, movement) => sum + integer(movement.quantity), 0);
  const exactMeals = consumed.filter((movement) => movement.confidence === "exact").reduce((sum, movement) => sum + integer(movement.quantity), 0);
  const derivedMeals = consumed.filter((movement) => movement.confidence === "derived").reduce((sum, movement) => sum + integer(movement.quantity), 0);
  const unknownMeals = consumed.filter((movement) => movement.confidence === "unknown").reduce((sum, movement) => sum + integer(movement.quantity), 0);
  const reservationMeals = movements.filter((movement) => movement.balanceEffect === "reserved").reduce((sum, movement) => sum + integer(movement.quantity), 0);
  const forfeitureMeals = movements.filter((movement) => movement.balanceEffect === "forfeited").reduce((sum, movement) => sum + integer(movement.quantity), 0);

  const consumption = {
    delivery: 0,
    branchPickup: 0,
    dashboardManual: 0,
    consumedWithoutPreparation: 0,
    noShow: 0,
    canceled: 0,
    other: 0,
    unknown: 0,
  };
  const selection = { mobileApp: 0, dashboard: 0, unknown: 0, notApplicable: 0 };

  for (const movement of consumed) {
    const quantity = integer(movement.quantity);
    if (movement.sourceCode === "delivery_fulfillment") consumption.delivery += quantity;
    else if (movement.sourceCode === "branch_pickup_fulfillment") consumption.branchPickup += quantity;
    else if (movement.sourceCode === "dashboard_manual_deduction") consumption.dashboardManual += quantity;
    else if (movement.sourceCode === "consumed_without_preparation") consumption.consumedWithoutPreparation += quantity;
    else if (movement.sourceCode === "pickup_no_show_consumption") consumption.noShow += quantity;
    else if (movement.sourceCode === "canceled_operation_consumption") consumption.canceled += quantity;
    else if (movement.confidence === "unknown") consumption.unknown += quantity;
    else consumption.other += quantity;

    if (movement.selection && movement.selection.code === "mobile_app") selection.mobileApp += quantity;
    else if (movement.selection && movement.selection.code === "dashboard") selection.dashboard += quantity;
    else if (movement.selection && movement.selection.code === "not_applicable") selection.notApplicable += quantity;
    else selection.unknown += quantity;
  }

  const authoritative = integer(balanceConsumedMeals);
  const difference = authoritative - representedMeals;
  return {
    status: unknownMeals === 0 && difference === 0 ? "complete" : "partial",
    balanceConsumedMeals: authoritative,
    representedMeals,
    attributedMeals: exactMeals + derivedMeals,
    exactMeals,
    derivedMeals,
    unknownMeals,
    reservationMeals,
    forfeitureMeals,
    difference,
    consumption,
    selection,
  };
}

async function enrichSubscriptionMealMovementProvenance(provenance = {}) {
  const movements = asArray(provenance.movements).map((movement) => ({ ...movement }));
  const pickupIds = [...new Set(movements
    .filter((movement) => movement.reference && movement.reference.type === "subscription_pickup_request" && movement.reference.id)
    .map((movement) => String(movement.reference.id)))];
  const activityLogIds = [...new Set(movements
    .filter((movement) => movement.reference && movement.reference.type === "activity_log" && movement.reference.id)
    .map((movement) => String(movement.reference.id)))];

  const [pickupRequests, activityLogs] = await Promise.all([
    pickupIds.length
      ? SubscriptionPickupRequest.find({ _id: { $in: pickupIds } })
        .select("_id snapshot selectedPickupItems selectedMealSlotIds selectedPickupItemIds")
        .lean()
      : [],
    activityLogIds.length
      ? ActivityLog.find({ _id: { $in: activityLogIds } })
        .select("_id meta byUserId byRole createdAt")
        .lean()
      : [],
  ]);

  const pickupMap = new Map(pickupRequests.map((request) => [String(request._id), request]));
  const activityLogMap = new Map(activityLogs.map((log) => [String(log._id), log]));

  for (const movement of movements) {
    const correction = correctedSource(movement);
    if (correction) Object.assign(movement, correction);

    if (
      !asArray(movement.mealItems).length
      && movement.reference
      && movement.reference.type === "subscription_pickup_request"
      && movement.reference.id
    ) {
      const request = pickupMap.get(String(movement.reference.id));
      const items = pickupSnapshotItems(request || {});
      if (items.length) movement.mealItems = items;
    }

    if (
      movement.sourceCode === "dashboard_manual_deduction"
      && movement.reference
      && movement.reference.type === "activity_log"
      && movement.reference.id
    ) {
      const log = activityLogMap.get(String(movement.reference.id));
      if (log) {
        const details = manualDeductionDetails(log);
        movement.sourceLabel = "خصم مباشر من رصيد الاشتراك عبر الداشبورد";
        movement.selection = {
          code: "not_applicable",
          label: "لا يوجد اختيار وجبات؛ هذه حركة خصم رصيد مباشرة",
          role: null,
        };
        movement.completion = { code: "manual_deduction", label: "تم خصم الرصيد مباشرة" };
        movement.deductionDetails = details;
        movement.reasonCode = details.reasonCode;
        movement.reasonLabel = details.reasonLabel;
        movement.reason = details.reasonLabel;
        movement.notes = details.notes || movement.notes || null;
        movement.fulfillmentContext = details.fulfillmentContext;
        movement.occurredAt = movement.occurredAt || log.createdAt || null;
        movement.actor = {
          id: movement.actor && movement.actor.id
            ? movement.actor.id
            : log.byUserId ? String(log.byUserId) : null,
          role: movement.actor && movement.actor.role
            ? movement.actor.role
            : log.byRole ? String(log.byRole) : null,
          email: movement.actor && movement.actor.email ? movement.actor.email : null,
        };
        movement.evidence = [...new Set([
          ...asArray(movement.evidence),
          "ActivityLog.meta.deductedRegularMeals",
          "ActivityLog.meta.deductedPremiumMeals",
          "ActivityLog.meta.before/after",
          "ActivityLog.meta.reason",
        ])];
      }
    }
  }

  return {
    ...provenance,
    contractVersion: "subscription_meal_movement_provenance.v3",
    coverage: recalculateCoverage(
      movements,
      provenance.coverage && provenance.coverage.balanceConsumedMeals
    ),
    movements,
  };
}

module.exports = {
  correctedSource,
  enrichSubscriptionMealMovementProvenance,
  manualDeductionDetails,
  pickupSnapshotItems,
  reasonLabel,
  recalculateCoverage,
  snapshotMealItem,
};
