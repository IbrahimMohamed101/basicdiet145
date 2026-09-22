const PromoCode = require("../models/PromoCode");

const CODE = "KS30";
const DEFAULT_CONFIG = {
  title: "KS30 - خصم 30%",
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

  if (!existing) {
    const created = await PromoCode.create({
      code: CODE,
      ...DEFAULT_CONFIG,
    });

    return {
      status: "created",
      id: String(created._id),
      code: created.code,
    };
  }

  let changed = false;
  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
    const current = existing[key];
    const same = Array.isArray(value)
      ? JSON.stringify(current || []) === JSON.stringify(value)
      : current instanceof Date || value instanceof Date
        ? new Date(current || 0).getTime() === new Date(value || 0).getTime()
        : current === value;

    if (!same) {
      existing[key] = value;
      changed = true;
    }
  }

  if (existing.code !== CODE) {
    existing.code = CODE;
    changed = true;
  }

  if (changed) {
    await existing.save();
  }

  return {
    status: changed ? "updated" : "already_normalized",
    id: String(existing._id),
    code: existing.code,
  };
}

module.exports = {
  ensureKs30Promo,
};
