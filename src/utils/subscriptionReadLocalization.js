const {
  formatDaysLabel,
  formatGramsLabel,
  formatMealsLabel,
  formatWindowLabel,
} = require("./subscriptionCatalog");
const {
  localizeAddonRows,
  localizeCustomItemRows,
  resolveCatalogOrStoredName,
  resolveFirstLocalizedText,
  resolveLocalizedText,
  resolveReadLabel,
} = require("./subscriptionLocalizationCommon");

function resolveWindowLabel(windowValue, lang) {
  const raw = String(windowValue || "").trim();
  if (!raw) return "";
  if (!/^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/.test(raw)) {
    return "";
  }
  return formatWindowLabel(raw, lang);
}

function localizeCustomSalads(rows, lang) {
  return localizeCustomItemRows(rows, lang);
}

function localizeCustomMeals(rows, lang) {
  return localizeCustomItemRows(rows, lang);
}

function localizePlanningView(planning, lang) {
  if (!planning || typeof planning !== "object") return planning;

  return {
    ...planning,
    stateLabel: resolveReadLabel("planningStates", planning.state, lang),
    premiumOverageStatusLabel: resolveReadLabel("paymentStatuses", planning.premiumOverageStatus, lang),
  };
}

function localizeDaySnapshot(snapshot, { lang, addonNames = new Map() } = {}) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return snapshot;
  }

  const localized = { ...snapshot };

  if (Array.isArray(snapshot.recurringAddons)) {
    localized.recurringAddons = localizeAddonRows(snapshot.recurringAddons, {
      lang,
      addonNames,
      preferStoredName: true,
    });
  }

  if (Array.isArray(snapshot.oneTimeAddonSelections)) {
    localized.oneTimeAddonSelections = localizeAddonRows(snapshot.oneTimeAddonSelections, {
      lang,
      addonNames,
      preferStoredName: true,
    });
  }

  if (snapshot.planning && typeof snapshot.planning === "object") {
    localized.planning = localizePlanningView(snapshot.planning, lang);
  }

  if (Array.isArray(snapshot.customSalads)) {
    localized.customSalads = localizeCustomSalads(snapshot.customSalads, lang);
  }

  if (Array.isArray(snapshot.customMeals)) {
    localized.customMeals = localizeCustomMeals(snapshot.customMeals, lang);
  }

  if (snapshot.oneTimeAddonPaymentStatus) {
    localized.oneTimeAddonPaymentStatusLabel = resolveReadLabel(
      "paymentStatuses",
      snapshot.oneTimeAddonPaymentStatus,
      lang
    );
  }

  return localized;
}

function localizeSubscriptionDayReadPayload(day, { lang, addonNames = new Map() } = {}) {
  if (!day || typeof day !== "object") return day;

  const localized = {
    ...day,
    statusLabel: resolveReadLabel("dayStatuses", day.status, lang),
  };

  if (Array.isArray(day.recurringAddons)) {
    localized.recurringAddons = localizeAddonRows(day.recurringAddons, {
      lang,
      addonNames,
      preferStoredName: Boolean(day.fulfilledSnapshot || day.lockedSnapshot),
    });
  }

  if (Array.isArray(day.oneTimeAddonSelections)) {
    localized.oneTimeAddonSelections = localizeAddonRows(day.oneTimeAddonSelections, {
      lang,
      addonNames,
      preferStoredName: Boolean(day.fulfilledSnapshot || day.lockedSnapshot),
    });
  }

  if (day.planning && typeof day.planning === "object") {
    localized.planning = localizePlanningView(day.planning, lang);
  }

  if (day.oneTimeAddonPaymentStatus) {
    localized.oneTimeAddonPaymentStatusLabel = resolveReadLabel(
      "paymentStatuses",
      day.oneTimeAddonPaymentStatus,
      lang
    );
  }

  if (Array.isArray(day.customSalads)) {
    localized.customSalads = localizeCustomSalads(day.customSalads, lang);
  }

  if (Array.isArray(day.customMeals)) {
    localized.customMeals = localizeCustomMeals(day.customMeals, lang);
  }

  if (day.lockedSnapshot) {
    localized.lockedSnapshot = localizeDaySnapshot(day.lockedSnapshot, { lang, addonNames });
  }

  if (day.fulfilledSnapshot) {
    localized.fulfilledSnapshot = localizeDaySnapshot(day.fulfilledSnapshot, { lang, addonNames });
  }

  return localized;
}

function localizeTimelineReadPayload(timeline, lang) {
  if (!timeline || typeof timeline !== "object") return timeline;

  return {
    subscriptionId: timeline.subscriptionId,
    dailyMealsRequired: timeline.dailyMealsConfig?.required || 3,
    days: Array.isArray(timeline.days)
      ? timeline.days.map((day) => {
        const weekdayShort = day.calendar?.weekday?.shortLabels?.[lang] || "";
        const monthShort = day.calendar?.month?.shortLabels?.[lang] || "";
        
        return {
          date: day.date,
          day: weekdayShort,
          month: monthShort,
          dayNumber: day.calendar?.dayOfMonth || 0,
          status: day.status,
          selectedMeals: day.meals?.selected || 0,
          requiredMeals: day.meals?.required || 0,
        };
      })
      : [],
  };
}

function localizeWalletHistoryEntries(entries, lang) {
  if (!Array.isArray(entries)) return entries;

  return entries.map((entry) => ({
    ...entry,
    sourceLabel: resolveReadLabel("walletHistorySources", entry.source, lang),
    directionLabel: resolveReadLabel("walletDirections", entry.direction, lang),
    walletTypeLabel: resolveReadLabel("walletTypes", entry.walletType, lang),
    statusLabel: resolveReadLabel("paymentStatuses", entry.status, lang),
  }));
}

function localizeWalletTopupStatusReadPayload(payload, lang) {
  if (!payload || typeof payload !== "object") return payload;

  return {
    ...payload,
    walletTypeLabel: resolveReadLabel("walletTypes", payload.walletType, lang),
    paymentStatusLabel: resolveReadLabel("paymentStatuses", payload.paymentStatus, lang),
  };
}

function localizeCheckoutDraftStatusReadPayload(payload, { lang, draft = null } = {}) {
  if (!payload || typeof payload !== "object") return payload;

  const localized = {
    ...payload,
    checkoutStatusLabel: resolveReadLabel("checkoutStatuses", payload.checkoutStatus, lang),
    paymentStatusLabel: resolveReadLabel("paymentStatuses", payload.paymentStatus, lang),
  };

  const planName = resolveFirstLocalizedText([
    draft && draft.contractSnapshot && draft.contractSnapshot.plan ? draft.contractSnapshot.plan.planName : null,
  ], lang);
  if (planName) {
    localized.planName = planName;
  }

  const deliveryMode = draft && draft.delivery && draft.delivery.type ? draft.delivery.type : null;
  if (deliveryMode) {
    localized.deliveryModeLabel = resolveReadLabel("deliveryModes", deliveryMode, lang);
  }

  const deliverySlotLabel = resolveWindowLabel(
    draft && draft.delivery && draft.delivery.slot ? draft.delivery.slot.window : "",
    lang
  );
  if (deliverySlotLabel) {
    localized.deliverySlotLabel = deliverySlotLabel;
  }

  return localized;
}

function localizeSubscriptionReadPayload(subscription, { lang, addonNames = new Map(), planName = "" } = {}) {
  if (!subscription || typeof subscription !== "object") return subscription;

  const localized = {
    ...subscription,
    statusLabel: resolveReadLabel("subscriptionStatuses", subscription.status, lang),
    deliveryModeLabel: resolveReadLabel("deliveryModes", subscription.deliveryMode, lang),
  };

  if (planName) {
    localized.planName = planName;
  }

  if (Array.isArray(subscription.addonSubscriptions)) {
    localized.addonSubscriptions = localizeAddonRows(subscription.addonSubscriptions, {
      lang,
      addonNames,
      preferStoredName: false,
    });
  }

  return localized;
}

function localizeRenewalSeedReadPayload(renewalSeed, { lang, livePlan = null, previousSubscription = null } = {}) {
  if (!renewalSeed || typeof renewalSeed !== "object") return renewalSeed;

  const livePlanName = resolveFirstLocalizedText([livePlan && livePlan.name ? livePlan.name : null], lang);
  const snapshotPlanName = resolveFirstLocalizedText([
    previousSubscription
      && previousSubscription.contractSnapshot
      && previousSubscription.contractSnapshot.plan
      ? previousSubscription.contractSnapshot.plan.planName
      : null,
  ], lang);
  const planName = livePlanName || snapshotPlanName;
  const deliveryPreference = renewalSeed.seed && renewalSeed.seed.deliveryPreference
    ? renewalSeed.seed.deliveryPreference
    : null;
  const slotLabel = resolveWindowLabel(
    deliveryPreference && deliveryPreference.slot ? deliveryPreference.slot.window : "",
    lang
  );

  return {
    ...renewalSeed,
    seedSourceLabel: resolveReadLabel("renewalSeedSources", renewalSeed.seedSource, lang),
    seed: renewalSeed.seed
      ? {
        ...renewalSeed.seed,
        planName,
        daysLabel: formatDaysLabel(renewalSeed.seed.daysCount, lang),
        gramsLabel: formatGramsLabel(renewalSeed.seed.grams, lang),
        mealsPerDayLabel: formatMealsLabel(renewalSeed.seed.mealsPerDay, lang, true),
        deliveryPreference: deliveryPreference
          ? {
            ...deliveryPreference,
            modeLabel: resolveReadLabel("deliveryModes", deliveryPreference.mode, lang),
            slot: deliveryPreference.slot
              ? {
                ...deliveryPreference.slot,
                ...(slotLabel ? { label: slotLabel } : {}),
              }
              : deliveryPreference.slot,
          }
          : deliveryPreference,
      }
      : renewalSeed.seed,
  };
}

function getGenericPremiumCreditsLabel(lang) {
  return resolveReadLabel("labels", "genericPremiumCredits", lang);
}

module.exports = {
  getGenericPremiumCreditsLabel,
  localizeCheckoutDraftStatusReadPayload,
  localizeCustomMeals,
  localizeCustomSalads,
  localizeDaySnapshot,
  localizePlanningView,
  localizeSubscriptionDayReadPayload,
  localizeSubscriptionReadPayload,
  localizeTimelineReadPayload,
  localizeRenewalSeedReadPayload,
  localizeWalletHistoryEntries,
  localizeWalletTopupStatusReadPayload,
  resolveCatalogOrStoredName,
  resolveFirstLocalizedText,
  resolveLocalizedText,
  resolveReadLabel,
  resolveWindowLabel,
};
