const mongoose = require("mongoose");
const SubscriptionDay = require("../models/SubscriptionDay");

async function buildRoutingReadModel(date, { zoneId, session } = {}) {
  const query = { date: String(date), status: { $in: ["open", "locked", "fulfilled"] } };
  const days = await SubscriptionDay.find(query).populate("subscriptionId").session(session).lean();
  
  const readModel = [];
  
  for (const day of days) {
    if (!Array.isArray(day.selections) || day.selections.length === 0) continue;
    
    const subscription = day.subscriptionId || {};
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
    if (!snapshot || !snapshot.planning) continue;
    const planning = snapshot.planning;
      
    const meals = (planning.baseMealSlots || []).map(s => String(s.mealId));
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
