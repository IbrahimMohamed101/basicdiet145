"use strict";

require("dotenv").config();

const mongoose = require("mongoose");
const PromoCode = require("../../src/models/PromoCode");

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

async function run() {
  if (!MONGO_URI) {
    throw new Error("MONGO_URI or MONGODB_URI is required");
  }

  await mongoose.connect(MONGO_URI);

  const existing = await PromoCode.findOne({
    $or: [
      { codeNormalized: "BESKDIET30" },
      { codeNormalized: "KSA96" },
    ],
  });

  if (!existing) {
    const created = await PromoCode.create({
      code: "KSA96",
      title: "KSA96 - خصم 30%",
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
    });

    console.log(JSON.stringify({
      action: "created",
      id: String(created._id),
      code: created.code,
      usageLimitPerUser: created.usageLimitPerUser,
      eligiblePlanDaysCounts: created.eligiblePlanDaysCounts,
    }, null, 2));
    return;
  }

  existing.code = "KSA96";
  existing.title = existing.title || "KSA96 - خصم 30%";
  existing.description = existing.description || "خصم 30% على اشتراكات 26 و30 يوم.";
  existing.isActive = true;
  existing.appliesTo = "subscription";
  existing.discountType = "percentage";
  existing.discountValue = 30;
  existing.usageLimitTotal = null;
  existing.usageLimitPerUser = 1;
  existing.eligiblePlanDaysCounts = [26, 30];
  existing.firstPurchaseOnly = false;
  existing.currency = "SAR";
  existing.deletedAt = null;

  await existing.save();

  console.log(JSON.stringify({
    action: "updated",
    id: String(existing._id),
    code: existing.code,
    discountValue: existing.discountValue,
    usageLimitTotal: existing.usageLimitTotal,
    usageLimitPerUser: existing.usageLimitPerUser,
    eligiblePlanDaysCounts: existing.eligiblePlanDaysCounts,
    isActive: existing.isActive,
  }, null, 2));
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
