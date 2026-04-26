const mongoose = require("mongoose");
const SubscriptionDay = require("../models/SubscriptionDay");
const Subscription = require("../models/Subscription");
const { buildSubscriptionDayFulfillmentState } = require("./subscription/subscriptionDayFulfillmentStateService");

function hasOperationalMeals(day) {
  const materializedCount = Array.isArray(day && day.materializedMeals) ? day.materializedMeals.filter(Boolean).length : 0;
  if (materializedCount > 0) return true;

  const planningBaseCount = day && day.lockedSnapshot && day.lockedSnapshot.planning && Array.isArray(day.lockedSnapshot.planning.baseMealSlots)
    ? day.lockedSnapshot.planning.baseMealSlots.filter((slot) => slot && slot.mealId).length
    : 0;
  if (planningBaseCount > 0) return true;

  return Array.isArray(day && day.selections) && day.selections.length > 0;
}

async function buildRoutingReadModel(date, { zoneId, session } = {}) {
  const query = { date: String(date), status: { $in: ["open", "locked", "fulfilled"] } };
  const days = await SubscriptionDay.find(query).populate("subscriptionId").session(session).lean();
  
  const readModel = [];
  
  for (const day of days) {
    const subscription = day.subscriptionId || {};
    const fulfillmentState = buildSubscriptionDayFulfillmentState({
      subscription,
      day,
      today: String(date),
    });
    if (!hasOperationalMeals(day) && !fulfillmentState.fulfillmentReady) continue;

    const deliveryMeta = day.lockedSnapshot && day.lockedSnapshot.delivery 
      ? day.lockedSnapshot.delivery 
      : (subscription.contractSnapshot ? subscription.contractSnapshot.delivery : subscription.delivery);
      
    if (!deliveryMeta) continue;
    
    if (zoneId && String(deliveryMeta.zoneId) !== String(zoneId)) continue;
    
    readModel.push({
      subscriptionId: String(subscription._id || day.subscriptionId),
      dayId: String(day._id),
      deliveryType: deliveryMeta.type || "delivery",
      address: deliveryMeta.address || null,
      notes: deliveryMeta.notes || null,
      slot: deliveryMeta.slot || null,
      zoneId: deliveryMeta.zoneId ? String(deliveryMeta.zoneId) : null,
      requiredMealCount: fulfillmentState.requiredMealCount,
      specifiedMealCount: fulfillmentState.specifiedMealCount,
      unspecifiedMealCount: fulfillmentState.unspecifiedMealCount,
      fulfillmentMode: fulfillmentState.fulfillmentMode,
      mealTypesSpecified: fulfillmentState.mealTypesSpecified,
    });
  }
  
  return readModel;
}

async function buildKitchenBatchReadModel(date, { session } = {}) {
  const query = {
    date: String(date),
    status: { $in: ["locked", "in_preparation", "out_for_delivery", "ready_for_pickup", "fulfilled"] },
  };
  const days = await SubscriptionDay.find(query).session(session).lean();
  
  const batchCounts = {
    meals: {},
    addons: {},
  };
  
  for (const day of days) {
    const snapshot = day.lockedSnapshot || day.fulfilledSnapshot || null;
    const planning = snapshot && snapshot.planning ? snapshot.planning : null;
      
    const meals = ((planning && planning.baseMealSlots) || []).map(s => String(s.mealId));
    for (const mealId of meals) {
      if (!mealId || mealId === "null" || mealId === "undefined") continue;
      batchCounts.meals[mealId] = (batchCounts.meals[mealId] || 0) + 1;
    }
  }
  
  return {
    date: String(date),
    ...batchCounts,
  };
}

module.exports = {
  buildRoutingReadModel,
  buildKitchenBatchReadModel,
};
