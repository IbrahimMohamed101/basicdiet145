"use strict";

const CHEF_CHOICE_LABEL = { ar: "اختيار الشيف", en: "Chef Choice" };
const CHEF_CHOICE_NOTICE_AR = "العميل لم يحدد الوجبات، سيتم تجهيز وجبات اختيار الشيف";

function positiveInteger(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function hasExplicitKitchenMeals(day = {}) {
  const mealSlots = Array.isArray(day.mealSlots) ? day.mealSlots : [];
  if (mealSlots.some((slot) => slot && slot.status === "complete")) return true;
  if (Array.isArray(day.materializedMeals) && day.materializedMeals.filter(Boolean).length > 0) return true;
  if (Array.isArray(day.selections) && day.selections.filter(Boolean).length > 0) return true;
  if (Array.isArray(day.baseMealSlots) && day.baseMealSlots.filter(Boolean).length > 0) return true;
  return false;
}

function isHomeDeliverySubscription(subscription = {}) {
  return subscription && subscription.deliveryMode !== "pickup";
}

function resolveDeliveryWindow(day = {}, subscription = {}) {
  return day.deliveryWindowOverride
    || day.deliveryWindow
    || (day.lockedSnapshot && (day.lockedSnapshot.deliveryWindow || day.lockedSnapshot.window))
    || (subscription && subscription.deliveryWindow)
    || "";
}

function resolveDeliveryAddress(day = {}, subscription = {}) {
  return day.deliveryAddressOverride
    || day.deliveryAddress
    || (day.lockedSnapshot && day.lockedSnapshot.deliveryAddress)
    || (subscription && subscription.deliveryAddress)
    || null;
}

function resolveHomeDeliveryEntitlementCount(day = {}, subscription = {}) {
  const requiredMealCount = positiveInteger(day && day.planningMeta && day.planningMeta.requiredMealCount)
    || positiveInteger(day && day.plannerMeta && day.plannerMeta.requiredSlotCount)
    || positiveInteger(day && day.lockedSnapshot && day.lockedSnapshot.requiredMealCount);
  if (requiredMealCount > 0) return requiredMealCount;

  const selectedMealsPerDay = positiveInteger(subscription && subscription.selectedMealsPerDay)
    || positiveInteger(day && day.context && day.context.selectedMealsPerDay);
  if (selectedMealsPerDay > 0) return selectedMealsPerDay;

  return 0;
}

function isValidHomeDeliveryChefChoiceDay(day = {}, subscription = {}) {
  if (!isHomeDeliverySubscription(subscription)) return false;
  if (!day || !day.date) return false;
  if (!resolveDeliveryWindow(day, subscription)) return false;
  if (!resolveDeliveryAddress(day, subscription)) return false;
  if (hasExplicitKitchenMeals(day)) return false;
  return resolveHomeDeliveryEntitlementCount(day, subscription) > 0;
}

function buildChefChoiceMealSlots(count, { startIndex = 1 } = {}) {
  return Array.from({ length: positiveInteger(count) }, (_, index) => ({
    slotIndex: startIndex + index,
    slotKey: `chef_choice_${startIndex + index}`,
    status: "complete",
    selectionType: "chef_choice",
    mealType: "chef_choice",
    productKey: "chef_choice",
    productName: CHEF_CHOICE_LABEL.en,
    productNameI18n: CHEF_CHOICE_LABEL,
    quantity: 1,
    isChefChoice: true,
  }));
}

module.exports = {
  CHEF_CHOICE_LABEL,
  CHEF_CHOICE_NOTICE_AR,
  buildChefChoiceMealSlots,
  hasExplicitKitchenMeals,
  isHomeDeliverySubscription,
  isValidHomeDeliveryChefChoiceDay,
  resolveDeliveryAddress,
  resolveDeliveryWindow,
  resolveHomeDeliveryEntitlementCount,
};
