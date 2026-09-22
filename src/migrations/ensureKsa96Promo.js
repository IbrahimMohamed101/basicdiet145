const PromoCode = require("../models/PromoCode");

const CODE = "KSA96";

async function ensureKsa96Promo() {
  const promo = await PromoCode.findOne({
    codeNormalized: CODE,
    deletedAt: null,
  });

  if (!promo) {
    const created = await PromoCode.create({
      code: CODE,
      title: "KSA96 - خصم 30%",
      description: "خصم 30% على اشتراكات 26 و30 يوم.",
      isActive: true,
      appliesTo: "subscription",
      discountType: "percentage",
      discountValue: 30,
      maxDiscountAmountHalala: null,
      minimumSubscriptionAmountHalala: null,
      startsAt: null,
      expiresAt: null,
      usageLimitTotal: null,
      usageLimitPerUser: 1,
      eligiblePlanIds: [],
      eligiblePlanDaysCounts: [26, 30],
      firstPurchaseOnly: false,
      currency: "SAR",
      deletedAt: null,
    });

    return {
      status: "created",
      id: String(created._id),
      code: created.code,
    };
  }

  const next = {
    code: CODE,
    isActive: true,
    appliesTo: "subscription",
    discountType: "percentage",
    discountValue: 30,
    maxDiscountAmountHalala: null,
    minimumSubscriptionAmountHalala: null,
    startsAt: null,
    expiresAt: null,
    usageLimitTotal: null,
    usageLimitPerUser: 1,
    eligiblePlanIds: [],
    eligiblePlanDaysCounts: [26, 30],
    firstPurchaseOnly: false,
    currency: "SAR",
    deletedAt: null,
  };

  let changed = false;
  for (const [key, value] of Object.entries(next)) {
    const current = promo[key];
    const same = Array.isArray(value)
      ? JSON.stringify(current || []) === JSON.stringify(value)
      : current === value;

    if (!same) {
      promo[key] = value;
      changed = true;
    }
  }

  if (!promo.title) {
    promo.title = "KSA96 - خصم 30%";
    changed = true;
  }

  if (!promo.description) {
    promo.description = "خصم 30% على اشتراكات 26 و30 يوم.";
    changed = true;
  }

  if (changed) {
    await promo.save();
  }

  return {
    status: changed ? "updated" : "already_normalized",
    id: String(promo._id),
    code: promo.code,
    eligiblePlanIds: [],
    eligiblePlanDaysCounts: [26, 30],
  };
}

module.exports = {
  ensureKsa96Promo,
};
