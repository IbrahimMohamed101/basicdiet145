const {
  formatDaysLabel,
  formatGramsLabel,
  formatMealsLabel,
  formatWindowLabel,
} = require("./subscriptionCatalog");
const {
  resolvePremiumKeyFromName,
  getPremiumDisplayName,
} = require("./premiumIdentity");
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

function normalizeCanonicalMealSlots(mealSlots) {
  if (!Array.isArray(mealSlots)) return [];

  return mealSlots.map((slot) => {
    const carbs = Array.isArray(slot && slot.carbs) && slot.carbs.length > 0
      ? slot.carbs.map((carb) => ({
        carbId: carb && carb.carbId ? String(carb.carbId) : "",
        grams: Number(carb && carb.grams || 0),
      }))
      : (slot && slot.carbId ? [{ carbId: String(slot.carbId), grams: 300 }] : []);
    const salad = slot && slot.salad
      ? slot.salad
      : (slot && slot.customSalad && typeof slot.customSalad === "object" ? slot.customSalad : null);

    return {
      slotIndex: Number(slot && slot.slotIndex || 0),
      slotKey: slot && slot.slotKey ? String(slot.slotKey) : "",
      status: slot && slot.status ? String(slot.status) : "empty",
      selectionType: slot && slot.selectionType ? String(slot.selectionType) : "empty",
      proteinId: slot && slot.proteinId ? String(slot.proteinId) : null,
      carbs,
      sandwichId: slot && slot.sandwichId ? String(slot.sandwichId) : null,
      salad,
      isPremium: Boolean(slot && slot.isPremium),
      premiumKey: slot && slot.premiumKey ? String(slot.premiumKey) : null,
      premiumSource: slot && slot.premiumSource ? String(slot.premiumSource) : "none",
      premiumExtraFeeHalala: Number(slot && slot.premiumExtraFeeHalala || 0),
    };
  });
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

  if (Array.isArray(day.mealSlots)) {
    localized.mealSlots = normalizeCanonicalMealSlots(day.mealSlots);
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
    premiumMealsRemaining: timeline.premiumMealsRemaining || 0,
    premiumMealsSelected: Number(timeline.premiumMealsSelected || 0),
    premiumBalanceBreakdown: Array.isArray(timeline.premiumBalanceBreakdown) ? timeline.premiumBalanceBreakdown : [],
    days: Array.isArray(timeline.days)
      ? timeline.days.map((day) => {
        const weekdayShort = day.calendar?.weekday?.shortLabels?.[lang] || "";
        const monthShort = day.calendar?.month?.shortLabels?.[lang] || "";
        const statusLabel = resolveReadLabel("timelineStatuses", day.status, lang);
        
        return {
          date: day.date,
          day: weekdayShort,
          month: monthShort,
          dayNumber: day.calendar?.dayOfMonth || 0,
          status: day.status,
          statusLabel,
          selectedMeals: day.meals?.selected || 0,
          requiredMeals: day.meals?.required || 0,
          commercialState: day.commercialState || "draft",
          commercialStateLabel: resolveReadLabel("commercialStates", day.commercialState, lang),
          isFulfillable: Boolean(day.isFulfillable),
          canBePrepared: Boolean(day.canBePrepared),
          paymentRequirement: day.paymentRequirement
            ? {
              ...day.paymentRequirement,
              pricingStatusLabel: resolveReadLabel("pricingStatuses", day.paymentRequirement.pricingStatus, lang),
              blockingReasonLabel: day.paymentRequirement.blockingReason
                ? resolveReadLabel("paymentBlockingReasons", day.paymentRequirement.blockingReason, lang)
                : null,
            }
            : null,
          fulfillmentMode: day.fulfillmentMode || "no_service",
          consumptionState: day.consumptionState || "pending_day",
          requiredMealCount: Number(day.requiredMealCount || 0),
          specifiedMealCount: Number(day.specifiedMealCount || 0),
          unspecifiedMealCount: Number(day.unspecifiedMealCount || 0),
          hasCustomerSelections: Boolean(day.hasCustomerSelections),
          requiresMealTypeKnowledge: Boolean(day.requiresMealTypeKnowledge),
          planningReady: Boolean(day.planningReady),
          fulfillmentReady: Boolean(day.fulfillmentReady),
          selectedMealIds: Array.isArray(day.selectedMealIds) ? day.selectedMealIds : [],
          mealSlots: normalizeCanonicalMealSlots(day.mealSlots),
        };
      })
      : [],
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

function localizeSubscriptionReadPayload(subscription, { lang, addonNames = new Map(), premiumNames = new Map(), premiumKeys = new Map(), planName = "" } = {}) {
  if (!subscription || typeof subscription !== "object") return subscription;

  const statusLabelAr = resolveReadLabel("subscriptionStatuses", subscription.status, "ar");
  const statusLabelEn = resolveReadLabel("subscriptionStatuses", subscription.status, "en");
  const deliveryModeLabelAr = resolveReadLabel("deliveryModes", subscription.deliveryMode, "ar");
  const deliveryModeLabelEn = resolveReadLabel("deliveryModes", subscription.deliveryMode, "en");

  const localized = {
    ...subscription,
    statusLabel: resolveReadLabel("subscriptionStatuses", subscription.status, lang),
    statusLabelAr,
    statusLabelEn,
    deliveryModeLabel: resolveReadLabel("deliveryModes", subscription.deliveryMode, lang),
    deliveryModeLabelAr,
    deliveryModeLabelEn,
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

  if (Array.isArray(subscription.premiumBalance)) {
    localized.premiumBalance = subscription.premiumBalance.map((item) => {
      const proteinId = item.proteinId ? String(item.proteinId) : null;
      let premiumKey = item.premiumKey;

      if (!premiumKey && proteinId) {
        premiumKey = premiumKeys.get(proteinId);
      }
      if (!premiumKey) {
        premiumKey = resolvePremiumKeyFromName(item.name || "");
      }

      // Final safety check: if still null, throw instead of silent fallback
      if (!premiumKey) {
        console.error(`[PREMIUM_BALANCE_CONSISTENCY] CRITICAL: Failed to resolve premiumKey for item:`, {
          proteinId,
          name: item.name
        });
        throw new Error("Invalid premiumBalance row: premiumKey is required");
      }

      return {
        ...item,
        premiumKey,
        name: getPremiumDisplayName({
          premiumKey,
          name: resolveCatalogOrStoredName({ 
            id: proteinId,
            liveName: proteinId ? premiumNames.get(proteinId) || "" : "",
            storedName: item.name || "", 
            lang 
          }),
          lang 
        }),
      };
    });
  } else {
    localized.premiumBalance = [];
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

module.exports = {
  localizeCheckoutDraftStatusReadPayload,

  localizeCustomMeals,
  localizeCustomSalads,
  localizeDaySnapshot,
  localizePlanningView,
  localizeSubscriptionDayReadPayload,
  localizeSubscriptionReadPayload,
  localizeTimelineReadPayload,
  localizeRenewalSeedReadPayload,
  resolveCatalogOrStoredName,
  resolveFirstLocalizedText,
  resolveLocalizedText,
  resolveReadLabel,
  resolveWindowLabel,
};
