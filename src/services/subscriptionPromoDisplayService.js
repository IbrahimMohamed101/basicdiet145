const PromoCode = require("../models/PromoCode");
const PromoUsage = require("../models/PromoUsage");
const Subscription = require("../models/Subscription");

const DEFAULT_CURRENCY = "SAR";

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
  const promos = await PromoCode.find({
    deletedAt: null,
    isActive: true,
    appliesTo: { $in: ["subscription", "all"] },
    "appDisplay.isVisible": true,
  })
    .sort({ "appDisplay.priority": -1, updatedAt: -1, _id: 1 })
    .limit(50)
    .lean();

  return selectPublicSubscriptionPromoOffer(promos, { userId, now });
}

module.exports = {
  buildDiscountLabel,
  serializePublicSubscriptionPromoOffer,
  isBaseDisplayEligible,
  isUserDisplayEligible,
  selectPublicSubscriptionPromoOffer,
  resolvePublicSubscriptionPromoOffer,
};
