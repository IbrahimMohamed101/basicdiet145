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

function resolveDayWalletSelections({ day }) {
  return {
    premiumUpgradeSelections: Array.isArray(day && day.premiumUpgradeSelections) ? day.premiumUpgradeSelections : [],
    addonSelections: Array.isArray(day && day.addonSelections) ? day.addonSelections : [],
  };
}

function applyDayWalletSelections({ day }) {
  if (!day) {
    return { premiumUpgradeSelections: [], addonSelections: [] };
  }
  const resolved = resolveDayWalletSelections({ day });
  day.premiumUpgradeSelections = resolved.premiumUpgradeSelections;
  day.addonSelections = resolved.addonSelections;
  return resolved;
}

module.exports = {
  resolveMealsPerDay,
  resolveDayWalletSelections,
  applyDayWalletSelections,
};
