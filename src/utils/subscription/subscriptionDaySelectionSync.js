function resolveMealsPerDay(sub) {
  if (Number.isInteger(sub && sub.selectedMealsPerDay) && sub.selectedMealsPerDay > 0) {
    return sub.selectedMealsPerDay;
  }
  if (sub && sub.planId && Number.isInteger(sub.planId.mealsPerDay) && sub.planId.mealsPerDay > 0) {
    return sub.planId.mealsPerDay;
  }
  if (
    sub
    && Number.isInteger(sub.totalMeals)
    && sub.totalMeals > 0
    && sub.planId
    && Number.isInteger(sub.planId.daysCount)
    && sub.planId.daysCount > 0
  ) {
    return Math.ceil(sub.totalMeals / sub.planId.daysCount);
  }
  return 1;
}

function matchesDay(selection, day) {
  if (!selection || !day) return false;
  if (selection.dayId && day._id && String(selection.dayId) === String(day._id)) {
    return true;
  }
  return Boolean(selection.date && day.date && String(selection.date) === String(day.date));
}

function buildPremiumUpgradeSelectionsForDay(subscription, day) {
  const source = Array.isArray(subscription && subscription.premiumSelections)
    ? subscription.premiumSelections
    : [];

  const sorted = source
    .filter((item) => matchesDay(item, day))
    .sort((a, b) => new Date(a.consumedAt || 0).getTime() - new Date(b.consumedAt || 0).getTime());

  const bySlot = new Map();
  for (const row of sorted) {
    const slotKey = String(row.baseSlotKey || "");
    if (!slotKey || bySlot.has(slotKey)) continue;
    bySlot.set(slotKey, {
      baseSlotKey: slotKey,
      premiumMealId: row.premiumMealId,
      unitExtraFeeHalala: Number(row.unitExtraFeeHalala || 0),
      currency: row.currency || "SAR",
      consumedAt: row.consumedAt || new Date(),
    });
  }
  return Array.from(bySlot.values());
}

function buildAddonCreditSelectionsForDay(subscription, day) {
  const source = Array.isArray(subscription && subscription.addonSelections)
    ? subscription.addonSelections
    : [];

  return source
    .filter((item) => matchesDay(item, day))
    .sort((a, b) => new Date(a.consumedAt || 0).getTime() - new Date(b.consumedAt || 0).getTime())
    .map((row) => ({
      addonId: row.addonId,
      qty: Number(row.qty || 0),
      unitPriceHalala: Number(row.unitPriceHalala || 0),
      currency: row.currency || "SAR",
      consumedAt: row.consumedAt || new Date(),
    }))
    .filter((row) => row.qty > 0);
}

function resolveDayWalletSelections({ subscription, day }) {
  const fromSubscriptionPremium = buildPremiumUpgradeSelectionsForDay(subscription, day);
  const fromSubscriptionAddons = buildAddonCreditSelectionsForDay(subscription, day);

  return {
    premiumUpgradeSelections: fromSubscriptionPremium,
    addonCreditSelections: fromSubscriptionAddons,
  };
}

function applyDayWalletSelections({ subscription, day }) {
  if (!day) {
    return { premiumUpgradeSelections: [], addonCreditSelections: [] };
  }
  const resolved = resolveDayWalletSelections({ subscription, day });
  day.premiumUpgradeSelections = resolved.premiumUpgradeSelections;
  day.addonCreditSelections = resolved.addonCreditSelections;
  return resolved;
}

module.exports = {
  resolveMealsPerDay,
  resolveDayWalletSelections,
  applyDayWalletSelections,
};
