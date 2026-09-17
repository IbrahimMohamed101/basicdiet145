const mongoose = require("mongoose");

const PromoCode = require("../models/PromoCode");
const PromoUsage = require("../models/PromoUsage");
const Setting = require("../models/Setting");
const Subscription = require("../models/Subscription");

const DEFAULT_CURRENCY = "SAR";
const APP_PROMO_SELECTION_SETTING_KEY = "subscription_app_promo_selection";

function readSelectedPromoCodeId(setting) {
  if (!setting) return null;
  const value = setting.value;
  const rawId = value && typeof value === "object" && !Array.isArray(value)
    ? value.promoCodeId
    : value;
  const normalized = String(rawId || "").trim();
  return mongoose.Types.ObjectId.isValid(normalized) ? normalized : null;
}

async function getSelectedAppPromoCodeId() {
  const setting = await Setting.findOne({ key: APP_PROMO_SELECTION_SETTING_KEY }).lean();
  return readSelectedPromoCodeId(setting);
}

function localizedText(value, fallback = { ar: "", en: "" }) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    ar: String(source.ar || fallback.ar || fallback.en || "").trim(),
    en: String(source.en || fallback.en || fallback.ar || "").trim(),
  };
}

function formatNumber(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0";
  return Number.isInteger(number)
    ? String(number)
    : number.toFixed(2).replace(/\.?0+$/, "");
}

function buildDiscountLabel(promo) {
  if (String(promo && promo.discountType || "") === "percentage") {
    const value = formatNumber(promo.discountValue);
    return { ar: `خصم ${value}%`, en: `${value}% OFF` };
  }

  const currency = String(promo && promo.currency || DEFAULT_CURRENCY).trim().toUpperCase();
  const amount = formatNumber(Number(promo && promo.discountValue || 0) / 100);
  const arCurrency = currency === "SAR" ? "ريال" : currency;
  return { ar: `خصم ${amount} ${arCurrency}`, en: `${amount} ${currency} OFF` };
}

function serializePublicSubscriptionPromoOffer(promo) {
  if (!promo) return null;
  const display = promo.appDisplay && typeof promo.appDisplay === "object"
    ? promo.appDisplay
    : {};
  const metadata = promo.metadata && typeof promo.metadata === "object"
    ? promo.metadata
    : {};
  const fallbackName = localizedText(metadata.name, {
    ar: String(promo.title || ""),
    en: String(promo.title || ""),
  });
  const fallbackDescription = localizedText(metadata.description, {
    ar: String(promo.description || ""),
    en: String(promo.description || ""),
  });

  return {
    id: String(promo._id || promo.id || ""),
    code: String(promo.code || "").trim().toUpperCase(),
    isVisible: true,
    showOnHome: display.showOnHome !== false,
    showOnPlans: display.showOnPlans !== false,
    discountLabel: buildDiscountLabel(promo),
    homeMessage: localizedText(display.homeMessage),
    title: localizedText(display.title, fallbackName),
    description: localizedText(display.description, fallbackDescription),
    startsAt: promo.startsAt || null,
    expiresAt: promo.expiresAt || null,
  };
}

function isBaseDisplayEligible(promo, { now = new Date(), userId = null } = {}) {
  if (!promo || promo.deletedAt || promo.isActive !== true) return false;
  if (!["subscription", "all"].includes(String(promo.appliesTo || ""))) return false;
  if (!promo.appDisplay || promo.appDisplay.isVisible !== true) return false;
  if (promo.appDisplay.showOnHome === false && promo.appDisplay.showOnPlans === false) return false;
  if (!String(promo.code || "").trim()) return false;
  if (promo.startsAt && new Date(promo.startsAt) > now) return false;
  if (promo.expiresAt && new Date(promo.expiresAt) < now) return false;
  if (
    promo.usageLimitTotal !== null
    && promo.usageLimitTotal !== undefined
    && Number(promo.currentUsageCount || 0) >= Number(promo.usageLimitTotal)
  ) {
    return false;
  }
  if (Array.isArray(promo.allowedUserIds) && promo.allowedUserIds.length > 0) {
    if (!userId) return false;
    if (!promo.allowedUserIds.some((id) => String(id) === String(userId))) return false;
  }
  return true;
}

async function isUserDisplayEligible(
  promo,
  userId,
  {
    countPromoUsages = ({ promoCodeId, userId: id }) => PromoUsage.countDocuments({
      promoCodeId,
      userId: id,
      status: { $in: ["reserved", "consumed"] },
    }),
    countSubscriptions = (id) => Subscription.countDocuments({
      userId: id,
      status: { $in: ["active", "expired", "canceled"] },
    }),
  } = {}
) {
  if (!userId) return true;
  if (promo.firstPurchaseOnly && await countSubscriptions(userId) > 0) return false;
  if (promo.usageLimitPerUser !== null && promo.usageLimitPerUser !== undefined) {
    const usageCount = await countPromoUsages({ promoCodeId: promo._id, userId });
    if (usageCount >= Number(promo.usageLimitPerUser)) return false;
  }
  return true;
}

async function selectPublicSubscriptionPromoOffer(
  promos,
  { userId = null, now = new Date(), eligibility = {} } = {}
) {
  for (const promo of Array.isArray(promos) ? promos : []) {
    if (!isBaseDisplayEligible(promo, { userId, now })) continue;
    if (!await isUserDisplayEligible(promo, userId, eligibility)) continue;
    return serializePublicSubscriptionPromoOffer(promo);
  }
  return null;
}

async function resolvePublicSubscriptionPromoOffer({ userId = null, now = new Date() } = {}) {
  const selectedPromoCodeId = await getSelectedAppPromoCodeId();
  if (!selectedPromoCodeId) return null;

  const promo = await PromoCode.findOne({
    _id: selectedPromoCodeId,
    deletedAt: null,
  }).lean();

  return selectPublicSubscriptionPromoOffer(promo ? [promo] : [], { userId, now });
}

function getAppPromoSelectionIssues(promo, { now = new Date() } = {}) {
  if (!promo) return ["PROMO_NOT_FOUND"];

  const issues = [];
  if (promo.deletedAt) issues.push("PROMO_ARCHIVED");
  if (!promo.isActive) issues.push("PROMO_INACTIVE");
  if (!["subscription", "all"].includes(String(promo.appliesTo || ""))) {
    issues.push("PROMO_NOT_APPLICABLE_TO_SUBSCRIPTIONS");
  }
  if (!promo.appDisplay || promo.appDisplay.isVisible !== true) {
    issues.push("PROMO_APP_DISPLAY_DISABLED");
  }
  if (promo.appDisplay && promo.appDisplay.showOnHome === false && promo.appDisplay.showOnPlans === false) {
    issues.push("PROMO_HAS_NO_APP_PLACEMENT");
  }
  if (promo.startsAt && new Date(promo.startsAt) > now) issues.push("PROMO_NOT_STARTED");
  if (promo.expiresAt && new Date(promo.expiresAt) < now) issues.push("PROMO_EXPIRED");
  if (
    promo.usageLimitTotal !== null
    && promo.usageLimitTotal !== undefined
    && Number(promo.currentUsageCount || 0) >= Number(promo.usageLimitTotal)
  ) {
    issues.push("PROMO_USAGE_LIMIT_REACHED");
  }
  return issues;
}

async function resolveAdminSubscriptionPromoSelection({ now = new Date() } = {}) {
  const promoCodeId = await getSelectedAppPromoCodeId();
  if (!promoCodeId) {
    return {
      promoCodeId: null,
      promo: null,
      issues: [],
      isPubliclyDisplayable: false,
    };
  }

  const promo = await PromoCode.findById(promoCodeId).lean();
  const issues = getAppPromoSelectionIssues(promo, { now });
  return {
    promoCodeId,
    promo,
    issues,
    isPubliclyDisplayable: issues.length === 0,
  };
}

function createSelectionError(code, message, status = 422) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

async function setSelectedAppPromoCode(promoCodeId) {
  const normalizedId = String(promoCodeId || "").trim();
  if (!normalizedId) {
    await Setting.findOneAndUpdate(
      { key: APP_PROMO_SELECTION_SETTING_KEY },
      {
        $set: {
          value: { promoCodeId: null },
          description: "The single promo code selected for display in the subscription app",
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return resolveAdminSubscriptionPromoSelection();
  }

  if (!mongoose.Types.ObjectId.isValid(normalizedId)) {
    throw createSelectionError("INVALID_ID", "promoCodeId is not a valid id", 400);
  }

  const promo = await PromoCode.findById(normalizedId);
  if (!promo || promo.deletedAt) {
    throw createSelectionError("PROMO_NOT_FOUND", "Promo code not found", 404);
  }
  if (!["subscription", "all"].includes(String(promo.appliesTo || ""))) {
    throw createSelectionError(
      "PROMO_NOT_APPLICABLE_TO_SUBSCRIPTIONS",
      "Only subscription promo codes can be selected for the app"
    );
  }

  promo.appDisplay = promo.appDisplay || {};
  promo.appDisplay.isVisible = true;
  if (promo.appDisplay.showOnHome === false && promo.appDisplay.showOnPlans === false) {
    promo.appDisplay.showOnHome = true;
    promo.appDisplay.showOnPlans = true;
  }
  await promo.save();

  await Setting.findOneAndUpdate(
    { key: APP_PROMO_SELECTION_SETTING_KEY },
    {
      $set: {
        value: { promoCodeId: String(promo._id) },
        description: "The single promo code selected for display in the subscription app",
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return resolveAdminSubscriptionPromoSelection();
}

async function clearSelectedAppPromoCodeIfMatches(promoCodeId) {
  const selectedPromoCodeId = await getSelectedAppPromoCodeId();
  if (selectedPromoCodeId !== String(promoCodeId || "")) return false;
  await setSelectedAppPromoCode(null);
  return true;
}

module.exports = {
  APP_PROMO_SELECTION_SETTING_KEY,
  readSelectedPromoCodeId,
  getSelectedAppPromoCodeId,
  buildDiscountLabel,
  serializePublicSubscriptionPromoOffer,
  isBaseDisplayEligible,
  isUserDisplayEligible,
  selectPublicSubscriptionPromoOffer,
  resolvePublicSubscriptionPromoOffer,
  getAppPromoSelectionIssues,
  resolveAdminSubscriptionPromoSelection,
  setSelectedAppPromoCode,
  clearSelectedAppPromoCodeIfMatches,
};
