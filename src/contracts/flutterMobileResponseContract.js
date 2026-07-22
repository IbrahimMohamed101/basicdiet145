"use strict";

class FlutterContractError extends Error {
  constructor(path, message) {
    super(`${path}: ${message}`);
    this.name = "FlutterContractError";
    this.code = "FLUTTER_RESPONSE_CONTRACT_MISMATCH";
    this.path = path;
  }
}

function fail(path, message) {
  throw new FlutterContractError(path, message);
}

function object(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "expected object");
  return value;
}

function array(value, path) {
  if (!Array.isArray(value)) fail(path, "expected array");
  return value;
}

function string(value, path, { allowEmpty = false } = {}) {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) fail(path, "expected non-empty string");
  return value;
}

function number(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(path, "expected finite number");
  return value;
}

function boolean(value, path) {
  if (typeof value !== "boolean") fail(path, "expected boolean");
  return value;
}

function optional(value, validator, path) {
  if (value !== undefined && value !== null) validator(value, path);
}

function successfulEnvelope(payload, path = "response") {
  object(payload, path);
  const success = typeof payload.status === "boolean"
    ? payload.status
    : typeof payload.ok === "boolean"
      ? payload.ok
      : typeof payload.status === "number"
        ? payload.status >= 200 && payload.status < 300
        : null;
  if (success !== true) fail(path, "expected a successful status/ok envelope");
  return payload;
}

function localized(value, path) {
  object(value, path);
  optional(value.ar, string, `${path}.ar`);
  optional(value.en, string, `${path}.en`);
  if (![value.ar, value.en].some((entry) => typeof entry === "string" && entry.trim())) {
    fail(path, "expected Arabic or English text");
  }
}

function validateAddonAllowance(row, path) {
  object(row, path);
  string(row.entitlementKey, `${path}.entitlementKey`);
  optional(row.addonPlanId, string, `${path}.addonPlanId`);
  string(row.allowanceCategory, `${path}.allowanceCategory`);
  number(row.includedTotalQty, `${path}.includedTotalQty`);
  number(row.consumedQty, `${path}.consumedQty`);
  number(row.reservedQty, `${path}.reservedQty`);
  number(row.remainingIncludedQty, `${path}.remainingIncludedQty`);
  number(row.maxPerDay, `${path}.maxPerDay`);
  optional(row.defaultDailyQty, number, `${path}.defaultDailyQty`);
  optional(row.walletRemainingQty, number, `${path}.walletRemainingQty`);
  optional(row.maximumSpendableFromWallet, number, `${path}.maximumSpendableFromWallet`);
}

function validateOverview(payload) {
  successfulEnvelope(payload, "overview");
  const data = object(payload.data, "overview.data");
  string(data._id, "overview.data._id");
  string(data.businessDate, "overview.data.businessDate");
  string(data.status, "overview.data.status");
  number(data.totalMeals, "overview.data.totalMeals");
  number(data.remainingMeals, "overview.data.remainingMeals");
  string(data.deliveryMode, "overview.data.deliveryMode");
  array(data.addonBalances || [], "overview.data.addonBalances");
  array(data.addonSubscriptionAllowances || [], "overview.data.addonSubscriptionAllowances")
    .forEach((row, index) => validateAddonAllowance(row, `overview.data.addonSubscriptionAllowances[${index}]`));
  array(data.addonCategoryAllowances || [], "overview.data.addonCategoryAllowances");
  optional(data.mealBalance, (value, path) => {
    object(value, path);
    number(value.totalMeals, `${path}.totalMeals`);
    number(value.remainingMeals, `${path}.remainingMeals`);
    number(value.consumedMeals, `${path}.consumedMeals`);
  }, "overview.data.mealBalance");
  return payload;
}

function validateAddonChoice(choice, path) {
  object(choice, path);
  const identity = choice.id || choice.productId || choice.menuProductId;
  string(identity, `${path}.id|productId|menuProductId`);
  if (!(typeof choice.name === "string" && choice.name.trim()) && !(choice.nameI18n && typeof choice.nameI18n === "object")) {
    fail(path, "expected name or nameI18n");
  }
  number(choice.priceHalala, `${path}.priceHalala`);
  number(choice.requestedQty, `${path}.requestedQty`);
  number(choice.coveredQty, `${path}.coveredQty`);
  number(choice.paidQty, `${path}.paidQty`);
  number(choice.payableTotalHalala, `${path}.payableTotalHalala`);
  number(choice.maxPerDay, `${path}.maxPerDay`);
  optional(choice.defaultDailyQty, number, `${path}.defaultDailyQty`);
  optional(choice.walletRemainingQty, number, `${path}.walletRemainingQty`);
  optional(choice.maximumSpendableFromWallet, number, `${path}.maximumSpendableFromWallet`);
  string(choice.pricingMode, `${path}.pricingMode`);
}

function validateAddonChoices(payload) {
  successfulEnvelope(payload, "addonChoices");
  const groups = [];
  if (payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)) {
    for (const [key, value] of Object.entries(payload.data)) {
      if (value && typeof value === "object" && Array.isArray(value.choices)) groups.push([`data.${key}`, value]);
    }
  }
  if (Array.isArray(payload.addonChoiceGroups)) {
    payload.addonChoiceGroups.forEach((value, index) => groups.push([`addonChoiceGroups[${index}]`, value]));
  }
  if (!groups.length) fail("addonChoices", "expected category maps or addonChoiceGroups");
  groups.forEach(([groupPath, group]) => {
    object(group, `addonChoices.${groupPath}`);
    string(group.category || group.displayCategory || group.allowanceCategory, `addonChoices.${groupPath}.category`);
    array(group.choices, `addonChoices.${groupPath}.choices`)
      .forEach((choice, index) => validateAddonChoice(choice, `addonChoices.${groupPath}.choices[${index}]`));
  });
  return payload;
}

function validateBuilderProduct(product, path) {
  object(product, path);
  string(product.id, `${path}.id`);
  string(product.key, `${path}.key`);
  string(product.name, `${path}.name`);
  object(product.nameI18n, `${path}.nameI18n`);
  string(product.selectionType, `${path}.selectionType`);
  string(product.itemType, `${path}.itemType`);
  number(product.priceHalala, `${path}.priceHalala`);
  optional(product.action, (value, actionPath) => {
    object(value, actionPath);
    string(value.type, `${actionPath}.type`);
    boolean(value.requiresBuilder, `${actionPath}.requiresBuilder`);
    boolean(value.treatAsFullMeal, `${actionPath}.treatAsFullMeal`);
  }, `${path}.action`);
}

function validateMealPlannerMenu(payload) {
  successfulEnvelope(payload, "mealPlannerMenu");
  const data = object(payload.data, "mealPlannerMenu.data");
  const catalog = object(data.builderCatalog || data.plannerCatalog, "mealPlannerMenu.data.builderCatalog");
  string(catalog.contractVersion || catalog.catalogVersion, "mealPlannerMenu.data.builderCatalog.contractVersion");
  array(catalog.sections, "mealPlannerMenu.data.builderCatalog.sections").forEach((section, sectionIndex) => {
    object(section, `mealPlannerMenu.sections[${sectionIndex}]`);
    string(section.id, `mealPlannerMenu.sections[${sectionIndex}].id`);
    string(section.key, `mealPlannerMenu.sections[${sectionIndex}].key`);
    string(section.selectionType, `mealPlannerMenu.sections[${sectionIndex}].selectionType`);
    array(section.products || [], `mealPlannerMenu.sections[${sectionIndex}].products`)
      .forEach((product, index) => validateBuilderProduct(product, `mealPlannerMenu.sections[${sectionIndex}].products[${index}]`));
  });
  object(data.addons || data.addonCatalog, "mealPlannerMenu.data.addons");
  return payload;
}

function validateMealSlot(slot, path) {
  object(slot, path);
  number(slot.slotIndex, `${path}.slotIndex`);
  string(slot.slotKey, `${path}.slotKey`);
  string(slot.status, `${path}.status`);
  array(slot.carbs || [], `${path}.carbs`);
  boolean(Boolean(slot.isPremium), `${path}.isPremium`);
  string(slot.premiumSource || "none", `${path}.premiumSource`);
  number(Number(slot.premiumExtraFeeHalala || 0), `${path}.premiumExtraFeeHalala`);
}

function validateSubscriptionDay(payload) {
  successfulEnvelope(payload, "subscriptionDay");
  const data = object(payload.data, "subscriptionDay.data");
  string(data.date, "subscriptionDay.data.date");
  string(data.status, "subscriptionDay.data.status");
  array(data.mealSlots, "subscriptionDay.data.mealSlots")
    .forEach((slot, index) => validateMealSlot(slot, `subscriptionDay.data.mealSlots[${index}]`));
  array(data.addonSelections || [], "subscriptionDay.data.addonSelections");
  array(data.addonBalance || data.addonBalances || [], "subscriptionDay.data.addonBalance");
  array(data.addonSubscriptionAllowances || [], "subscriptionDay.data.addonSubscriptionAllowances")
    .forEach((row, index) => validateAddonAllowance(row, `subscriptionDay.data.addonSubscriptionAllowances[${index}]`));
  object(data.paymentRequirement || {}, "subscriptionDay.data.paymentRequirement");
  return payload;
}

function validatePickupSlot(slot, path) {
  object(slot, path);
  string(slot.slotId || slot.slotKey, `${path}.slotId|slotKey`);
  optional(slot.slotIndex, number, `${path}.slotIndex`);
  if (slot.productId) string(slot.productName, `${path}.productName`);
  const title = slot.title || slot.meal && slot.meal.title || slot.product && slot.product.name;
  localized(title, `${path}.title`);
  const display = object(slot.display, `${path}.display`);
  string(display.titleAr, `${path}.display.titleAr`);
  string(display.titleEn, `${path}.display.titleEn`);
  boolean(slot.available, `${path}.available`);
  boolean(slot.canSelect, `${path}.canSelect`);
}

function validatePickupAvailability(payload) {
  successfulEnvelope(payload, "pickupAvailability");
  const data = object(payload.data, "pickupAvailability.data");
  string(data.subscriptionId, "pickupAvailability.data.subscriptionId");
  string(data.date, "pickupAvailability.data.date");
  const wallet = object(data.wallet || data.entitlementWallet, "pickupAvailability.data.wallet");
  number(wallet.consumedMeals, "pickupAvailability.data.wallet.consumedMeals");
  number(wallet.reservedMeals, "pickupAvailability.data.wallet.reservedMeals");
  number(wallet.availableMeals != null ? wallet.availableMeals : wallet.remainingMeals, "pickupAvailability.data.wallet.availableMeals");
  const slots = data.slots || data.plannedSlots || [];
  array(slots, "pickupAvailability.data.slots").forEach((slot, index) => validatePickupSlot(slot, `pickupAvailability.data.slots[${index}]`));
  array(data.pickupItems || [], "pickupAvailability.data.pickupItems");
  object(data.summary, "pickupAvailability.data.summary");
  boolean(data.canAppendMeals, "pickupAvailability.data.canAppendMeals");
  number(data.appendLimit, "pickupAvailability.data.appendLimit");
  return payload;
}

function validatePickupRequestData(data, path) {
  object(data, path);
  string(data.requestId || data.id, `${path}.requestId|id`);
  string(data.subscriptionId, `${path}.subscriptionId`);
  string(data.date, `${path}.date`);
  number(data.mealCount, `${path}.mealCount`);
  string(data.status, `${path}.status`);
  string(data.statusLabel, `${path}.statusLabel`);
  number(data.currentStep, `${path}.currentStep`);
  boolean(data.creditsReserved, `${path}.creditsReserved`);
  boolean(data.isReady, `${path}.isReady`);
  boolean(data.isCompleted, `${path}.isCompleted`);
  array(data.selectedMealSlotIds || [], `${path}.selectedMealSlotIds`);
  array(data.selectedPickupItemIds || [], `${path}.selectedPickupItemIds`);
}

function validatePickupRequest(payload) {
  successfulEnvelope(payload, "pickupRequest");
  validatePickupRequestData(payload.data, "pickupRequest.data");
  return payload;
}

function validatePickupRequests(payload) {
  successfulEnvelope(payload, "pickupRequests");
  const source = Array.isArray(payload.data)
    ? payload.data
    : payload.data && (payload.data.requests || payload.data.pickupRequests || payload.data.items);
  array(source || [], "pickupRequests.data").forEach((row, index) => validatePickupRequestData(row, `pickupRequests.data[${index}]`));
  return payload;
}

function validatePickupStatus(payload) {
  successfulEnvelope(payload, "pickupStatus");
  const data = object(payload.data, "pickupStatus.data");
  string(data.subscriptionId, "pickupStatus.data.subscriptionId");
  string(data.date, "pickupStatus.data.date");
  number(data.currentStep, "pickupStatus.data.currentStep");
  string(data.status, "pickupStatus.data.status");
  string(data.statusLabel, "pickupStatus.data.statusLabel");
  boolean(data.canModify, "pickupStatus.data.canModify");
  boolean(data.isReady, "pickupStatus.data.isReady");
  boolean(data.isCompleted, "pickupStatus.data.isCompleted");
  boolean(data.pickupRequested, "pickupStatus.data.pickupRequested");
  boolean(data.pickupPrepared, "pickupStatus.data.pickupPrepared");
  return payload;
}

function validateFulfillmentStatus(payload) {
  successfulEnvelope(payload, "fulfillmentStatus");
  const data = object(payload.data, "fulfillmentStatus.data");
  string(data.subscriptionId, "fulfillmentStatus.data.subscriptionId");
  string(data.date, "fulfillmentStatus.data.date");
  string(data.deliveryMode, "fulfillmentStatus.data.deliveryMode");
  string(data.effectiveFulfillmentMode || data.fulfillmentMode, "fulfillmentStatus.data.fulfillmentMode");
  string(data.status, "fulfillmentStatus.data.status");
  string(data.statusLabel, "fulfillmentStatus.data.statusLabel");
  string(data.commercialState, "fulfillmentStatus.data.commercialState");
  string(data.consumptionState, "fulfillmentStatus.data.consumptionState");
  boolean(data.planningReady, "fulfillmentStatus.data.planningReady");
  boolean(data.fulfillmentReady, "fulfillmentStatus.data.fulfillmentReady");
  boolean(data.isFulfillable, "fulfillmentStatus.data.isFulfillable");
  boolean(data.canBePrepared, "fulfillmentStatus.data.canBePrepared");
  boolean(data.isTerminal, "fulfillmentStatus.data.isTerminal");
  number(data.pollingIntervalSeconds, "fulfillmentStatus.data.pollingIntervalSeconds");
  return payload;
}

module.exports = {
  FlutterContractError,
  validateAddonChoices,
  validateFulfillmentStatus,
  validateMealPlannerMenu,
  validateOverview,
  validatePickupAvailability,
  validatePickupRequest,
  validatePickupRequests,
  validatePickupStatus,
  validateSubscriptionDay,
};
