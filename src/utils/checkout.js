const crypto = require("crypto");

const SYSTEM_CURRENCY = "SAR";

function normalizeCurrencyValue(value) {
  return String(value || SYSTEM_CURRENCY).trim().toUpperCase();
}

function buildCheckoutRequestHash({ userId, quote }) {
  const premiumItems = (quote.premiumItems || [])
    .map((item) => ({
      id: String(item.premiumMeal && item.premiumMeal._id ? item.premiumMeal._id : item.premiumMealId || ""),
      qty: Number(item.qty || 0),
      unitExtraFeeHalala: Number(item.unitExtraFeeHalala || 0),
      currency: normalizeCurrencyValue(item.premiumMeal && item.premiumMeal.currency ? item.premiumMeal.currency : item.currency),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const addonItems = (quote.addonItems || [])
    .map((item) => ({
      id: String(item.addon && item.addon._id ? item.addon._id : item.addonId || ""),
      qty: Number(item.qty || 0),
      unitPriceHalala: Number(item.unitPriceHalala || 0),
      currency: normalizeCurrencyValue(item.addon && item.addon.currency ? item.addon.currency : item.currency),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const canonicalPayload = {
    userId: String(userId),
    planId: String(quote.plan && quote.plan._id ? quote.plan._id : ""),
    planCurrency: normalizeCurrencyValue(quote.plan && quote.plan.currency),
    daysCount: Number(quote.plan && quote.plan.daysCount ? quote.plan.daysCount : 0),
    grams: Number(quote.grams || 0),
    mealsPerDay: Number(quote.mealsPerDay || 0),
    startDate: quote.startDate ? new Date(quote.startDate).toISOString() : null,
    delivery: {
      type: quote.delivery && quote.delivery.type ? quote.delivery.type : "delivery",
      zoneId:
        quote.delivery && quote.delivery.zoneId
          ? String(quote.delivery.zoneId)
          : "",
      zoneName:
        quote.delivery && quote.delivery.zoneName
          ? String(quote.delivery.zoneName)
          : "",
      slotType:
        quote.delivery && quote.delivery.slot && quote.delivery.slot.type
          ? quote.delivery.slot.type
          : "delivery",
      window:
        quote.delivery && quote.delivery.slot && quote.delivery.slot.window
          ? String(quote.delivery.slot.window)
          : "",
      slotId:
        quote.delivery && quote.delivery.slot && quote.delivery.slot.slotId
          ? String(quote.delivery.slot.slotId)
          : "",
      pickupLocationId:
        quote.delivery && quote.delivery.pickupLocationId
          ? String(quote.delivery.pickupLocationId)
          : "",
      address: quote.delivery && quote.delivery.address ? quote.delivery.address : null,
    },
    premiumItems,
    premiumWalletMode: quote.premiumWalletMode || "legacy_itemized",
    premiumCount: Number(quote.premiumCount || 0),
    premiumUnitPriceHalala: Number(quote.premiumUnitPriceHalala || 0),
    addonItems,
    breakdown: {
      basePlanPriceHalala: Number(quote.breakdown.basePlanPriceHalala || 0),
      premiumTotalHalala: Number(quote.breakdown.premiumTotalHalala || 0),
      addonsTotalHalala: Number(quote.breakdown.addonsTotalHalala || 0),
      deliveryFeeHalala: Number(quote.breakdown.deliveryFeeHalala || 0),
      vatHalala: Number(quote.breakdown.vatHalala || 0),
      totalHalala: Number(quote.breakdown.totalHalala || 0),
    },
  };

  return crypto.createHash("sha256").update(JSON.stringify(canonicalPayload)).digest("hex");
}

function normalizeCheckoutDeliveryForPersistence(delivery = {}) {
  const normalizedType = delivery && delivery.type === "pickup" ? "pickup" : "delivery";
  const slot = delivery && delivery.slot && typeof delivery.slot === "object" ? delivery.slot : {};

  return {
    type: normalizedType,
    address: delivery && delivery.address ? delivery.address : null,
    zoneId: normalizedType === "delivery" ? (delivery && delivery.zoneId ? delivery.zoneId : null) : null,
    zoneName:
      normalizedType === "delivery"
        ? String(delivery && delivery.zoneName ? delivery.zoneName : "").trim()
        : "",
    slot: {
      type: normalizedType,
      window: slot && slot.window ? String(slot.window) : "",
      slotId: slot && slot.slotId ? String(slot.slotId) : "",
    },
  };
}

module.exports = {
  buildCheckoutRequestHash,
  normalizeCheckoutDeliveryForPersistence,
};