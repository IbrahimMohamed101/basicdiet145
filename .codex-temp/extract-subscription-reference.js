require("dotenv").config();

const mongoose = require("mongoose");
const { connectDb } = require("../src/db");
const User = require("../src/models/User");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const Payment = require("../src/models/Payment");
const CheckoutDraft = require("../src/models/CheckoutDraft");
const report = require("./subscription-seed-report.json");

const todayKsa = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());

function pickDay(days, predicate) {
  const match = days.find(predicate);
  if (!match) return null;
  return {
    id: String(match._id),
    date: match.date,
    status: match.status,
    planningState: match.planningState || null,
    premiumOverageStatus: match.premiumOverageStatus || null,
    oneTimeAddonPaymentStatus: match.oneTimeAddonPaymentStatus || null,
  };
}

async function main() {
  await connectDb();

  const emails = report.sampleAccounts.appUsers.map((u) => u.email);
  const users = await User.find({ email: { $in: emails } }).lean();
  const output = [];

  for (const account of report.sampleAccounts.appUsers) {
    const user = users.find((u) => u.email === account.email);
    const subscriptions = await Subscription.find({ userId: user._id }).sort({ createdAt: -1 }).lean();
    const drafts = await CheckoutDraft.find({ userId: user._id }).sort({ createdAt: -1 }).lean();
    const payments = await Payment.find({ userId: user._id }).sort({ createdAt: -1 }).lean();

    const subRows = [];
    for (const sub of subscriptions) {
      const days = await SubscriptionDay.find({ subscriptionId: sub._id }).sort({ date: 1 }).lean();
      const subPayments = payments
        .filter((p) => String(p.subscriptionId || "") === String(sub._id))
        .map((p) => ({
          id: String(p._id),
          type: p.type,
          status: p.status,
          applied: Boolean(p.applied),
          providerInvoiceId: p.providerInvoiceId || null,
        }));
      const linkedDrafts = drafts
        .filter((d) => String(d.subscriptionId || "") === String(sub._id) || String(d.renewedFromSubscriptionId || "") === String(sub._id))
        .map((d) => ({
          id: String(d._id),
          status: d.status,
          paymentId: d.paymentId ? String(d.paymentId) : null,
          renewedFromSubscriptionId: d.renewedFromSubscriptionId ? String(d.renewedFromSubscriptionId) : null,
        }));

      subRows.push({
        id: String(sub._id),
        status: sub.status,
        deliveryMode: sub.deliveryMode,
        deliveryZoneName: sub.deliveryZoneName || null,
        startDate: sub.startDate ? sub.startDate.toISOString() : null,
        endDate: sub.endDate ? sub.endDate.toISOString() : null,
        validityEndDate: sub.validityEndDate ? sub.validityEndDate.toISOString() : null,
        drafts: linkedDrafts,
        payments: subPayments,
        keyDays: {
          today: pickDay(days, (d) => d.date === todayKsa),
          open: pickDay(days, (d) => d.status === "open"),
          frozen: pickDay(days, (d) => d.status === "frozen"),
          skipped: pickDay(days, (d) => d.status === "skipped"),
          locked: pickDay(days, (d) => d.status === "locked"),
          outForDelivery: pickDay(days, (d) => d.status === "out_for_delivery"),
          readyForPickup: pickDay(days, (d) => d.status === "ready_for_pickup"),
          fulfilled: pickDay(days, (d) => d.status === "fulfilled"),
          draftPlanning: pickDay(days, (d) => d.planningState === "draft"),
          confirmedPlanning: pickDay(days, (d) => d.planningState === "confirmed"),
          premiumOveragePending: pickDay(days, (d) => d.premiumOverageStatus === "pending"),
          premiumOveragePaid: pickDay(days, (d) => d.premiumOverageStatus === "paid"),
          oneTimeAddonPending: pickDay(days, (d) => d.oneTimeAddonPaymentStatus === "pending"),
          oneTimeAddonPaid: pickDay(days, (d) => d.oneTimeAddonPaymentStatus === "paid"),
        },
      });
    }

    output.push({
      key: account.key,
      email: account.email,
      phone: account.phone,
      token: account.token,
      tokenSource: ".codex-temp/subscription-seed-report.json",
      useCase: account.useCase,
      subscriptions: subRows,
      standaloneDrafts: drafts
        .filter((d) => !d.subscriptionId)
        .map((d) => ({
          id: String(d._id),
          status: d.status,
          paymentId: d.paymentId ? String(d.paymentId) : null,
          renewedFromSubscriptionId: d.renewedFromSubscriptionId ? String(d.renewedFromSubscriptionId) : null,
        })),
      standalonePayments: payments
        .filter((p) => !p.subscriptionId)
        .map((p) => ({
          id: String(p._id),
          type: p.type,
          status: p.status,
          applied: Boolean(p.applied),
          providerInvoiceId: p.providerInvoiceId || null,
        })),
    });
  }

  console.log(JSON.stringify({ todayKsa, accounts: output }, null, 2));
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exitCode = 1;
});
