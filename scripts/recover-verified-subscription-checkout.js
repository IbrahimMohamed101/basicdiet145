#!/usr/bin/env node
"use strict";

require("dotenv").config();
const mongoose = require("mongoose");
const { resolveMongoUri } = require("../src/utils/mongoUriResolver");

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : null;
  if (!value || value.startsWith("--")) throw new Error(`--${name} is required`);
  return value;
}
const mask = value => value ? `${String(value).slice(0, 4)}…${String(value).slice(-4)}` : null;

async function main() {
  if (process.argv.includes("--help")) {
    console.log("node scripts/recover-verified-subscription-checkout.js --user-id ID --draft-id ID --invoice-id ID --provider-payment-id ID [--apply]\nDefault: provider verification and database inspection only. --apply records verified paid state and calls official single-payment recovery.");
    return;
  }
  const userId = arg("user-id"), draftId = arg("draft-id");
  const invoiceId = arg("invoice-id"), providerPaymentId = arg("provider-payment-id");
  if (![userId, draftId].every(v => mongoose.isValidObjectId(v))) throw new Error("Invalid user or draft ID");
  const apply = process.argv.includes("--apply");
  // Operational recovery must not create collections/indexes or schedule jobs.
  mongoose.set("autoIndex", false);
  mongoose.set("autoCreate", false);
  require("../src/services/installSubscriptionBackendRepairComposition");
  require("../src/services/installSubscriptionStackingWriteRouter");
  const Draft = require("../src/models/CheckoutDraft");
  const Payment = require("../src/models/Payment");
  const Subscription = require("../src/models/Subscription");
  const Batch = require("../src/models/SubscriptionEntitlementBatch");
  const { settlePaidSubscriptionPayment } = require("../src/services/subscription/subscriptionVerifiedPaymentService");
  await mongoose.connect(resolveMongoUri(), { serverSelectionTimeoutMS: 10000, autoIndex: false, autoCreate: false });
  try {
    const draft = await Draft.findById(draftId).lean();
    const payments = await Payment.find({ provider: "moyasar", $or: [
      { providerInvoiceId: invoiceId }, { providerPaymentId },
    ] }).limit(2).lean();
    const payment = payments[0];
    if (!draft || payments.length !== 1 || String(draft.userId) !== userId ||
        String(payment.userId) !== userId || String(draft.paymentId) !== String(payment._id) ||
        draft.providerInvoiceId !== invoiceId || payment.providerInvoiceId !== invoiceId) {
      throw new Error("STOP: checkout/payment ownership, invoice or uniqueness mismatch");
    }
    if (![draft.daysCount, draft.mealsPerDay, draft.grams].every(v => Number.isSafeInteger(v) && v > 0)) {
      throw new Error("STOP: saved package quantities are incomplete");
    }
    const settled = await settlePaidSubscriptionPayment({ paymentId: payment._id,
      providerInvoiceId: invoiceId, providerPaymentId, apply });
    const [latestDraft, latestPayment, batches] = await Promise.all([
      Draft.findById(draftId).lean(), Payment.findById(payment._id).lean(),
      Batch.find({ $or: [{ paymentId: payment._id }, { checkoutDraftId: draft._id }] }).limit(2).lean(),
    ]);
    const subscription = latestPayment.subscriptionId
      ? await Subscription.findOne({ _id: latestPayment.subscriptionId, userId }).lean() : null;
    const batch = batches[0];
    const additive = draft.stackingFinalization?.mode === "additive_existing_parent";
    const linked = latestPayment.status === "paid" && latestPayment.applied === true &&
      latestDraft.status === "completed" && subscription &&
      String(latestDraft.subscriptionId) === String(subscription._id);
    const batchMatches = batches.length === 1 && batch.applicationState === "applied" &&
      batch.status !== "canceled" && String(batch.paymentId) === String(payment._id) &&
      String(batch.checkoutDraftId) === draftId && String(batch.userId) === userId &&
      String(batch.containerSubscriptionId) === String(subscription?._id) &&
      batch.daysCount === draft.daysCount && batch.mealsPerDay === draft.mealsPerDay &&
      batch.proteinGrams === draft.grams && batch.totalMeals === draft.daysCount * draft.mealsPerDay &&
      batch.pricingSnapshot?.totalPriceHalala === payment.amount && batch.pricingSnapshot?.currency === payment.currency;
    const complete = Boolean(linked && (additive ? batchMatches : true));
    console.log(JSON.stringify({ mode: apply ? "apply" : "read_only", providerVerified: settled.verified,
      payment: mask(payment._id), draft: mask(draft._id), paymentStatus: latestPayment.status,
      applied: latestPayment.applied, draftStatus: latestDraft.status,
      recovery: settled.recovery ? { recovered: settled.recovery.recovered,
        idempotent: settled.recovery.idempotent || false, reason: settled.recovery.reason || null } : null,
      subscription: mask(subscription?._id),
      subscriptionStatus: subscription?.status || null, purchaseCount: batches.length,
      package: { days: draft.daysCount, mealsPerDay: draft.mealsPerDay, grams: draft.grams,
        totalMeals: draft.daysCount * draft.mealsPerDay },
      purchase: batch ? { id: mask(batch._id), status: batch.status, applicationState: batch.applicationState,
        totalMeals: batch.totalMeals, remainingMeals: batch.remainingMeals,
        consumedMeals: batch.consumedMeals, reservedMeals: batch.reservedMeals,
        effectiveStartDate: batch.effectiveStartDate, endDate: batch.endDate } : null,
      complete,
    }, null, 2));
    if (!settled.verified || (apply && !complete)) process.exitCode = 2;
  } finally { await mongoose.disconnect(); }
}

main().catch(async error => {
  console.error(JSON.stringify({ code: error.code || "RECOVERY_STOPPED", message: "Recovery stopped; do not edit records or override checkout routing. Review provider matching and official recovery logs." }));
  await mongoose.disconnect();
  process.exitCode = 1;
});
