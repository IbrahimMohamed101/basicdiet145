
const mongoose = require("mongoose");
const sinon = require("sinon");
const assert = require("node:assert");

// 1. Mock dependencies *before* requiring EVERYTHING
const commercialService = require("../src/services/subscription/subscriptionDayCommercialStateService");
sinon.stub(commercialService, "applyCommercialStateToDay").callsFake((day) => {
  const d = (day && typeof day.toObject === "function") ? day.toObject() : (day || {});
  return { 
    ...d, 
    _id: d._id,
    paymentRequirement: { requiresPayment: true, canCreatePayment: true },
    plannerRevisionHash: "rev123",
    commercialState: { test: true },
    premiumSummary: { pendingPaymentCount: 1 },
    premiumExtraPayment: { createdAt: new Date() }
  };
});
sinon.stub(commercialService, "finalizeDayCommercialStateForPersistence").callsFake(async (day) => {
  const d = (day && typeof day.toObject === "function") ? day.toObject() : (day || {});
  return { 
    ...day, 
    _id: d._id,
    paymentRequirement: { requiresPayment: true, canCreatePayment: true },
    plannerRevisionHash: d.plannerRevisionHash || "rev123",
    premiumSummary: { pendingPaymentCount: 1 },
    premiumExtraPayment: { createdAt: new Date() }
  };
});

const modificationPolicy = require("../src/services/subscription/subscriptionDayModificationPolicyService");
sinon.stub(modificationPolicy, "assertSubscriptionDayModifiable").resolves();

const { createUnifiedDayPaymentFlow } = require("../src/services/subscription/unifiedDayPaymentService");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const Payment = require("../src/models/Payment");
const featureFlags = require("../src/utils/featureFlags");
const loggerUtils = require("../src/utils/logger");

// Mock logger
sinon.stub(loggerUtils.logger, "error").callsFake((msg, meta) => {
    console.log("Service Error Log:", msg);
});

async function runTest() {
  console.log("Running Unified Day Idempotency Verification Test...");

  const mockSubId = new mongoose.Types.ObjectId();
  const mockUserId = new mongoose.Types.ObjectId();
  const mockDayId = new mongoose.Types.ObjectId();
  
  const mockSub = {
    _id: mockSubId,
    userId: mockUserId,
    status: "active",
    planId: { mealsPerDay: 3 }
  };

  const mockDay = {
    _id: mockDayId,
    subscriptionId: mockSubId,
    date: "2026-05-10",
    status: "open",
    mealSlots: [
      { slotIndex: 0, isPremium: true, premiumSource: "pending_payment", premiumExtraFeeHalala: 2000 }
    ],
    addonSelections: [],
    plannerRevisionHash: "rev123",
    toObject: function() { return { ...this }; }
  };

  const mockPayment = {
    _id: new mongoose.Types.ObjectId(),
    id: "pay_new",
    status: "initiated",
    applied: false,
    providerInvoiceId: "inv_123",
    amount: 2000,
    currency: "SAR",
    metadata: { totalHalala: 2000, paymentUrl: "https://pay.me" }
  };

  // Stubs for Models
  sinon.stub(Subscription, "findById").resolves(mockSub);
  sinon.stub(SubscriptionDay, "findOne").resolves(mockDay);
  let findByIdDay = { ...mockDay, _id: mockDayId };
  sinon.stub(SubscriptionDay, "findById").returns({
    lean: () => Promise.resolve(findByIdDay)
  });
  sinon.stub(SubscriptionDay, "updateOne").resolves({ modifiedCount: 1 });
  const dayUpdateStub = SubscriptionDay.updateOne;
  
  // Payment find stub
  const paymentFindByIdStub = sinon.stub(Payment, "findById");
  paymentFindByIdStub.returns({
    lean: () => Promise.resolve(mockPayment)
  });
  const paymentUpdateStub = sinon.stub(Payment, "updateOne").resolves({ modifiedCount: 1 });
  
  const createPaymentStub = sinon.stub().resolves(mockPayment);
  const createInvoiceStub = sinon.stub().resolves({ id: "inv_123", url: "https://pay.me", currency: "SAR", metadata: {} });

  const mockRuntime = {
    createInvoice: createInvoiceStub,
    createPayment: createPaymentStub,
    parseOperationIdempotencyKey: () => "test-idempotency-key",
    buildOperationRequestHash: () => "test-hash-789",
    findPaymentByOperationKey: sinon.stub(),
    findReusableInitiatedPaymentByHash: sinon.stub().resolves(null),
    compareIdempotentRequest: () => "reuse",
  };

  const ensureActiveFn = () => {};

  // Scenario 1: Flag is ON, First Request
  sinon.stub(featureFlags, "isPhase1NonCheckoutPaidIdempotencyEnabled").returns(true);
  mockRuntime.findPaymentByOperationKey.resolves(null);

  console.log("Testing First Request...");
  const result1 = await createUnifiedDayPaymentFlow({
    subscriptionId: mockSubId,
    date: "2026-05-10",
    userId: mockUserId,
    lang: "en",
    headers: { "x-idempotency-key": "test-idempotency-key" },
    runtime: mockRuntime,
    ensureActiveFn
  });

  assert.strictEqual(result1.ok, true);
  assert.strictEqual(result1.data.payment_url, "https://pay.me", "Success response should keep payment_url");
  assert.strictEqual(result1.data.invoice_id, "inv_123", "Success response should keep invoice_id");
  assert.ok(result1.data.commercialState, "Success response should contain commercialState");
  assert.ok(result1.data.paymentRequirement, "Success response should contain paymentRequirement");
  assert.strictEqual(result1.data.plannerRevisionHash, "rev123", "Success response should contain plannerRevisionHash");
  assert.strictEqual(createInvoiceStub.callCount, 1, "Invoice should be created on first request");
  console.log("✅ First request saved idempotency keys correctly.");

  // Scenario 2: Second Request with same key (REUSE)
  const existingPayment = {
    ...mockPayment,
    _id: new mongoose.Types.ObjectId(),
    id: "pay_existing",
    providerInvoiceId: "inv_old",
    operationRequestHash: "test-hash-789",
    metadata: { 
        paymentUrl: "https://pay.old", 
        initiationResponseShape: "day_planning_payment",
        totalHalala: 2000
    }
  };
  mockRuntime.findPaymentByOperationKey.resolves(existingPayment);
  
  // Update findById stub for Scenario 2
  paymentFindByIdStub.returns({
    lean: () => Promise.resolve(existingPayment)
  });

  // Update runtime mock for Scenario 2
  mockRuntime.findReusableInitiatedPaymentByHash.resolves(existingPayment);

  console.log("Testing Second Request (Duplicate)...");
  const result2 = await createUnifiedDayPaymentFlow({
    subscriptionId: mockSubId,
    date: "2026-05-10",
    userId: mockUserId,
    lang: "en",
    headers: { "x-idempotency-key": "test-idempotency-key" },
    runtime: mockRuntime,
    ensureActiveFn
  });

  assert.strictEqual(result2.ok, true);
  assert.strictEqual(result2.status, 200);
  assert.strictEqual(result2.data.invoice_id, "inv_old", "Should return existing invoice ID");
  
  // Verify compatibility with Unified Flow response shape
  assert.ok(result2.data.commercialState, "Reuse response should contain commercialState");
  assert.ok(result2.data.paymentRequirement, "Reuse response should contain paymentRequirement");
  assert.strictEqual(result2.data.plannerRevisionHash, "rev123", "Reuse response should contain plannerRevisionHash");
  
  assert.strictEqual(createInvoiceStub.callCount, 1, "Invoice should NOT be created again");
  assert.strictEqual(createPaymentStub.callCount, 1, "Payment should NOT be created again");
  console.log("✅ Second request (duplicate) correctly reused existing payment with FULL response payload.");

  // Scenario 3: Day update does not modify a matching day after payment creation
  console.log("Testing day update failure does not leave usable initiated payment...");
  mockRuntime.parseOperationIdempotencyKey = () => "";
  mockRuntime.findPaymentByOperationKey.resolves(null);
  mockRuntime.findReusableInitiatedPaymentByHash.resolves(null);
  createInvoiceStub.resetHistory();
  createPaymentStub.resetHistory();
  paymentUpdateStub.resetHistory();
  dayUpdateStub.resolves({ matchedCount: 1, modifiedCount: 0 });
  findByIdDay = {
    ...mockDay,
    _id: mockDayId,
    premiumExtraPayment: {
      status: "pending",
      paymentId: new mongoose.Types.ObjectId(),
      providerInvoiceId: "inv_other",
      revisionHash: "rev_other"
    }
  };

  const result3 = await createUnifiedDayPaymentFlow({
    subscriptionId: mockSubId,
    date: "2026-05-10",
    userId: mockUserId,
    lang: "en",
    headers: {},
    runtime: mockRuntime,
    ensureActiveFn
  });

  assert.strictEqual(result3.ok, false);
  assert.strictEqual(result3.status, 500);
  assert.strictEqual(result3.code, "PAYMENT_PERSISTENCE_ERROR");
  assert.strictEqual(createInvoiceStub.callCount, 1, "Invoice may be created once before day update failure");
  assert.strictEqual(createPaymentStub.callCount, 1, "Payment should be recorded before day update failure");
  assert.strictEqual(paymentUpdateStub.callCount, 1, "Payment should be marked unusable");
  assert.strictEqual(paymentUpdateStub.firstCall.args[1].$set.status, "failed");
  assert.strictEqual(paymentUpdateStub.firstCall.args[1].$set.applied, false);
  assert.strictEqual(
    paymentUpdateStub.firstCall.args[1].$set.metadata.initiationFailureReason,
    "subscription_day_update_failed"
  );
  assert.ok(!result3.data || !result3.data.payment_url, "Failure response should not return payment_url");
  console.log("✅ unified_day_payment_day_update_failure_should_not_leave_usable_initiated_payment passed.");

  // Scenario 4: No-op update is successful when the day is already linked to the same payment
  console.log("Testing matching no-op day update succeeds...");
  createInvoiceStub.resetHistory();
  createPaymentStub.resetHistory();
  paymentUpdateStub.resetHistory();
  dayUpdateStub.resolves({ matchedCount: 1, modifiedCount: 0 });
  findByIdDay = {
    ...mockDay,
    _id: mockDayId,
    premiumExtraPayment: {
      status: "pending",
      paymentId: mockPayment._id,
      providerInvoiceId: "inv_123",
      revisionHash: "rev123"
    }
  };

  const result4 = await createUnifiedDayPaymentFlow({
    subscriptionId: mockSubId,
    date: "2026-05-10",
    userId: mockUserId,
    lang: "en",
    headers: {},
    runtime: mockRuntime,
    ensureActiveFn
  });

  assert.strictEqual(result4.ok, true);
  assert.strictEqual(result4.status, 201);
  assert.strictEqual(result4.data.payment_url, "https://pay.me");
  assert.strictEqual(result4.data.invoice_id, "inv_123");
  assert.strictEqual(paymentUpdateStub.callCount, 0, "Matching no-op should not mark payment unusable");
  console.log("✅ unified_day_payment_noop_update_with_matching_payment_should_succeed passed.");

  // Scenario 5: No-op update fails when the day is linked to a different payment
  console.log("Testing mismatched no-op day update fails...");
  createInvoiceStub.resetHistory();
  createPaymentStub.resetHistory();
  paymentUpdateStub.resetHistory();
  dayUpdateStub.resolves({ matchedCount: 1, modifiedCount: 0 });
  findByIdDay = {
    ...mockDay,
    _id: mockDayId,
    premiumExtraPayment: {
      status: "pending",
      paymentId: new mongoose.Types.ObjectId(),
      providerInvoiceId: "inv_other",
      revisionHash: "rev123"
    }
  };

  const result5 = await createUnifiedDayPaymentFlow({
    subscriptionId: mockSubId,
    date: "2026-05-10",
    userId: mockUserId,
    lang: "en",
    headers: {},
    runtime: mockRuntime,
    ensureActiveFn
  });

  assert.strictEqual(result5.ok, false);
  assert.strictEqual(result5.status, 500);
  assert.strictEqual(result5.code, "PAYMENT_PERSISTENCE_ERROR");
  assert.strictEqual(paymentUpdateStub.callCount, 1, "Mismatched no-op should mark payment unusable");
  assert.strictEqual(paymentUpdateStub.firstCall.args[1].$set.status, "failed");
  assert.strictEqual(
    paymentUpdateStub.firstCall.args[1].$set.metadata.initiationFailureReason,
    "subscription_day_update_failed"
  );
  assert.ok(!result5.data || !result5.data.payment_url, "Mismatched no-op failure should not return payment_url");
  console.log("✅ unified_day_payment_noop_update_with_mismatched_payment_should_fail passed.");

  // Scenario 6: Day is no longer open between validation and update
  console.log("Testing day not open does not return payment_url...");
  createInvoiceStub.resetHistory();
  createPaymentStub.resetHistory();
  paymentUpdateStub.resetHistory();
  dayUpdateStub.resolves({ matchedCount: 0, modifiedCount: 0 });

  const result6 = await createUnifiedDayPaymentFlow({
    subscriptionId: mockSubId,
    date: "2026-05-10",
    userId: mockUserId,
    lang: "en",
    headers: {},
    runtime: mockRuntime,
    ensureActiveFn
  });

  assert.strictEqual(result6.ok, false);
  assert.strictEqual(result6.status, 409);
  assert.strictEqual(result6.code, "LOCKED");
  assert.strictEqual(createInvoiceStub.callCount, 1, "Invoice may be created once before day-open race is detected");
  assert.strictEqual(createPaymentStub.callCount, 1, "Payment should be recorded before day-open race is detected");
  assert.strictEqual(paymentUpdateStub.callCount, 1, "Payment should be marked unusable");
  assert.strictEqual(paymentUpdateStub.firstCall.args[1].$set.status, "failed");
  assert.strictEqual(
    paymentUpdateStub.firstCall.args[1].$set.metadata.initiationFailureReason,
    "subscription_day_not_open"
  );
  assert.ok(!result6.data || !result6.data.payment_url, "Locked failure response should not return payment_url");
  console.log("✅ unified_day_payment_day_not_open_should_not_return_payment_url passed.");

  console.log("✅ ALL Unified Day Idempotency Tests Passed!");
  process.exit(0);
}

runTest().catch(err => {
  console.error("❌ Test Failed!");
  console.error(err);
  process.exit(1);
});
