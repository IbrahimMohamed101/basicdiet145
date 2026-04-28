const Plan = require("../models/Plan");
const Subscription = require("../models/Subscription");
const Payment = require("../models/Payment");
const User = require("../models/User");
const CheckoutDraft = require("../models/CheckoutDraft");
const { logger } = require("../utils/logger");

/**
 * Scan active plans for health issues.
 * Returns a list of plans with detected anomalies.
 */
async function checkPlanCatalogHealth() {
  const activePlans = await Plan.find({ isActive: true }).lean();
  const report = {
    totalActivePlans: activePlans.length,
    anomalies: [],
  };

  for (const plan of activePlans) {
    const issues = [];
    
    if (!Plan.isViable(plan)) {
      issues.push("NON_VIABLE: Missing sellable active grams/meals options or valid active pricing");
    }

    // Check for zero prices in active options
    const gramsOptions = plan.gramsOptions || [];
    for (const g of gramsOptions.filter(opt => opt.isActive !== false)) {
      const activeMeals = (g.mealsOptions || []).filter(m => m.isActive !== false);
      for (const m of activeMeals) {
        if (!m.priceHalala || m.priceHalala <= 0) {
          issues.push(`ZERO_PRICE: Grams ${g.grams}, Meals ${m.mealsPerDay} has price 0`);
        }
      }
    }

    if (issues.length > 0) {
      report.anomalies.push({
        planId: plan._id,
        name: plan.name,
        issues,
      });
    }
  }

  return report;
}

/**
 * Scan for subscription and payment integrity issues.
 */
async function auditSubscriptionIntegrity() {
  const report = {
    ghostPayments: [],
    orphanedSubscriptions: [],
  };

  // 1. Ghost Payments: Paid but not applied/no subscription
  const paidUnappliedPayments = await Payment.find({
    status: "paid",
    type: { $in: ["subscription_activation", "subscription_renewal"] },
    applied: false,
  }).lean();

  for (const pay of paidUnappliedPayments) {
    // Check if subscription exists anyway
    const hasSub = await Subscription.exists({ $or: [{ _id: pay.subscriptionId }, { userId: pay.userId, createdAt: { $gte: pay.createdAt } }] });
    if (!hasSub) {
      report.ghostPayments.push({
        paymentId: pay._id,
        userId: pay.userId,
        amount: pay.amount,
        paidAt: pay.paidAt || pay.updatedAt,
      });
    }
  }

  // 2. Orphaned Subscriptions: Subscription without valid user
  // (Optional but good for integrity)
  const subscriptions = await Subscription.find().select("userId").lean();
  for (const sub of subscriptions) {
    if (sub.userId) {
      const userExists = await User.exists({ _id: sub.userId });
      if (!userExists) {
        report.orphanedSubscriptions.push({
          subscriptionId: sub._id,
          userId: sub.userId,
          issue: "USER_NOT_FOUND",
        });
      }
    }
  }

  return report;
}

module.exports = {
  checkPlanCatalogHealth,
  auditSubscriptionIntegrity,
};
