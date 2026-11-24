"use strict";
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const Payment = require("../src/models/Payment");
const CheckoutDraft = require("../src/models/CheckoutDraft");
const User = require("../src/models/User");
const LandingLead = require("../src/models/LandingLead");
const { buildLandingPaidConversionReport } = require("../src/services/landingPaidConversionReadService");

async function run() {
  const server = await MongoMemoryServer.create({ instance: { args: ["--nounixsocket"] } });
  try {
    await mongoose.connect(server.getUri("landing_paid_conversion_test"), { autoIndex: false });
    // Fixture-only raw inserts avoid unrelated required business fields.
    const id = () => new mongoose.Types.ObjectId();
    const userId = id(), subscriptionId = id();
    const at = new Date("2026-11-24T10:00:00Z");
    const leadAt = new Date("2026-11-23T10:00:00Z");
    await User.collection.insertOne({ _id: userId, phoneE164: "+966500000000" });
    await LandingLead.collection.insertOne({ _id: id(), phone: "+966500000000", createdAt: leadAt, contactConsent: true, source: "ig" });
    async function fixture({ payment = {}, draft = {} } = {}) {
      const paymentId = id(), draftId = id();
      await Payment.collection.insertOne({ _id: paymentId, userId, subscriptionId, checkoutDraftId: draftId, type: "subscription_activation",
        amount: 118600, currency: "SAR", status: "paid", applied: true, paidAt: at, ...payment });
      await CheckoutDraft.collection.insertOne({ _id: draftId, userId, subscriptionId, paymentId, status: "completed", completedAt: at, ...draft });
      return paymentId;
    }
    await fixture();
    await fixture({payment:{type:"subscription_renewal", paidAt:new Date(at.getTime()+1000)},draft:{completedAt:new Date(at.getTime()+1000)}});
    await fixture({payment:{applied:false}});
    await fixture({payment:{status:"refunded"}});
    await fixture({draft:{status:"pending_payment"}});
    await fixture({draft:{subscriptionId:id()}});
    await fixture({draft:{userId:id()}});
    await fixture({draft:{paymentId:id()}});
    const report = await buildLandingPaidConversionReport({ from: "2026-11-24", to:"2026-11-24" });
    assert.equal(report.completed, 2);
    assert.equal(report.renewalPayments, 1);
    assert.equal(report.activationPayments, 1);
    assert.equal(report.leadMatched, 1);
    assert.equal(report.unmatched, 1);
    assert.equal(report.leadMatchedAmountHalala, 118600);
    assert.equal(report.amountHalala, 237200);
    assert.deepEqual(report.sources, [{ source:"instagram", completed:1, amountHalala:118600 }]);
    assert.equal(JSON.stringify(report).includes("+966500000000"), false);
    const empty = await buildLandingPaidConversionReport({from:"2026-11-25",to:"2026-11-25"});
    assert.equal(empty.completed, 0);
    console.log("Isolated Mongo paid conversion integration: PASS");
  } finally { await mongoose.disconnect(); await server.stop(); }
}
run().catch(err=>{ console.error(err); process.exitCode=1; });
