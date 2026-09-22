const PromoCode = require("../models/PromoCode");

const CODE = "KS30";
const DEFAULT_CONFIG = {
  title: "KS30 - خصم 30%",
  description: "خصم 30% على اشتراكات 26 و30 يوم.",
  isActive: true,
  appliesTo: "subscription",
  discountType: "percentage",
  discountValue: 30,
  usageLimitTotal: null,
  usageLimitPerUser: 1,
  eligiblePlanDaysCounts: [26, 30],
  firstPurchaseOnly: false,
  currency: "SAR",
  deletedAt: null,
};

async function ensureKs30Promo() {
  const existing = await PromoCode.findOne({
    codeNormalized: CODE,
    deletedAt: null,
  });

  if (existing) {
    return {
      status: "already_present",
      id: String(existing._id),
      code: existing.code,
    };
  }

  const created = await PromoCode.create({
    code: CODE,
    ...DEFAULT_CONFIG,
  });

  return {
    status: "created",
    id: String(created._id),
    code: created.code,
    discountValue: created.discountValue,
    eligiblePlanDaysCounts: created.eligiblePlanDaysCounts,
  };
}

module.exports = {
  ensureKs30Promo,
};
