const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const sinon = require("sinon");

const { resolveCheckoutQuoteOrThrow } = require("../src/services/subscription/subscriptionQuoteService");
const { createUnifiedDayPaymentFlow } = require("../src/services/subscription/unifiedDayPaymentService");
const checkoutService = require("../src/services/subscription/subscriptionCheckoutService");

const Plan = require("../src/models/Plan");
const Addon = require("../src/models/Addon");
const AddonPlanPrice = require("../src/models/AddonPlanPrice");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const Subscription = require("../src/models/Subscription");
const Payment = require("../src/models/Payment");
const Zone = require("../src/models/Zone");
const Setting = require("../src/models/Setting");

let mongoServer;

async function setup() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
  
  // Create default delivery windows setting
  await Setting.create({
    key: "delivery_windows",
    value: [{ id: "delivery_slot_1", window: "Morning" }]
  });
}

async function teardown() {
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
  }
}

async function runTests() {
  const results = {
    task1: { status: "pending", logs: [] },
    task2: { status: "pending", logs: [] }
  };

  const log1 = (msg) => { results.task1.logs.push(msg); console.log("[Task 1]", msg); };
  const log2 = (msg) => { results.task2.logs.push(msg); console.log("[Task 2]", msg); };

  await setup();

  try {
    // --- Task 1: Addon Fixed Pricing Matrix ---
    log1("Setting up test data for 30-day fixed pricing addon...");

    const zone = await Zone.create({ name: { en: "Test Zone", ar: "منطقة تجربة" }, isActive: true, deliveryFeeHalala: 0 });
    
    const plan = await Plan.create({
      name: { en: "30 Day Plan", ar: "30 يوم" },
      daysCount: 30,
      isActive: true,
      currency: "SAR",
      gramsOptions: [{
        grams: 100,
        isActive: true,
        mealsOptions: [{
          mealsPerDay: 2,
          isActive: true,
          priceHalala: 100000,
          compareAtHalala: 0
        }]
      }]
    });

    const addon = await Addon.create({
      name: { en: "Small Salad 30 Days", ar: "سلطة صغيرة" },
      kind: "plan",
      category: "small_salad",
      pricingMode: "base_plan_matrix",
      priceHalala: 500, // 5 SAR fallback price
      isActive: true,
    });

    const exactFixedPrice = 27000; // 270 SAR
    await AddonPlanPrice.create({
      addonPlanId: addon._id,
      basePlanId: plan._id,
      priceHalala: exactFixedPrice,
      isActive: true
    });

    const quotePayload = {
      planId: String(plan._id),
      grams: 100,
      mealsPerDay: 2,
      delivery: {
        type: "delivery",
        zoneId: String(zone._id),
        slotId: "delivery_slot_1",
        window: "Morning"
      },
      addons: [{ id: String(addon._id), qty: 1 }]
    };

    log1("Triggering subscription quote service...");
    const quote = await resolveCheckoutQuoteOrThrow(quotePayload, { allowMissingDeliveryAddress: true });
    const quotedAddon = quote.addonItems.find(a => String(a.addonPlanId) === String(addon._id));

    if (!quotedAddon) throw new Error("Addon missing from quote result");
    
    log1(`Quoted unit price: ${quotedAddon.unitPriceHalala / 100} SAR`);
    log1(`Quoted total price: ${quotedAddon.totalHalala / 100} SAR`);
    
    if (quotedAddon.totalHalala !== exactFixedPrice) {
      throw new Error(`Expected exactly ${exactFixedPrice} halala, got ${quotedAddon.totalHalala}`);
    }
    log1("✅ Assertion 1 & 2 Passed: Exact matrix price retrieved without duration multiplication.");
    results.task1.status = "passed";


    // --- Task 2: Unified Day Payment Initiation ---
    log2("Setting up test data for pending payment addon selections...");

    const sub = new Subscription({
      status: "active",
      clientId: new mongoose.Types.ObjectId(),
      userId: new mongoose.Types.ObjectId(),
      planId: plan._id,
      totalMeals: 30
    });
    await sub.save({ validateBeforeSave: false });

    const day = new SubscriptionDay({
      subscriptionId: sub._id,
      date: "2026-08-01",
      status: "open",
      deliveryType: "delivery",
      addonSelections: [
        {
          id: "extra_snack_1",
          addonId: new mongoose.Types.ObjectId(),
          category: "snack",
          source: "pending_payment",
          status: "pending",
          qty: 1,
          priceHalala: 1500
        }
      ]
    });
    await day.save({ validateBeforeSave: false });

    let interceptedMetadata = null;
    const { logger } = require("../src/utils/logger");
    const loggerStub = sinon.stub(logger, "error").callsFake((msg, meta) => {
      console.error("[LOGGER ERROR]", msg, meta);
    });

    const flowPayload = {
      subscriptionId: String(sub._id),
      userId: String(sub.userId),
      date: "2026-08-01",
      checkoutAmountHalala: 1500,
      body: {}, // Testing with empty redirectContext & missing URLs
      runtime: {
        parseOperationIdempotencyKey: () => "",
        buildOperationRequestHash: () => "hash123",
        findPaymentByOperationKey: async () => null,
        findReusableInitiatedPaymentByHash: async () => null,
        createInvoice: async (payload) => {
          interceptedMetadata = payload.metadata;
          return { id: "inv_mock_999", status: "initiated", url: "https://moyasar.com/mock", currency: "SAR" };
        },
        createPayment: async (payload) => {
          console.log("[MOCK RUNTIME] createPayment called!", payload);
          return { 
            _id: new mongoose.Types.ObjectId(), 
            id: "mock_payment_123", 
            status: "initiated", 
            providerInvoiceId: payload.providerInvoiceId || "inv_mock_999" 
          };
        }
      }
    };

    log2("Triggering createUnifiedDayPaymentFlow with empty body (null checks test)...");
    const result = await createUnifiedDayPaymentFlow(flowPayload);

    if (result.status !== 201) {
      throw new Error(`Flow failed with status ${result.status}: ${result.message} - ${JSON.stringify(result.details || {})}`);
    }
    log2("✅ Assertion 1 Passed: Handled null values correctly and returned 201 Created.");

    if (!interceptedMetadata) {
      throw new Error("No metadata intercepted from Moyasar call");
    }

    let hasNested = false;
    for (const key in interceptedMetadata) {
      if (typeof interceptedMetadata[key] === "object" && interceptedMetadata[key] !== null) {
        hasNested = true;
      }
    }
    if (hasNested) {
      throw new Error("Metadata contains nested objects. It was not fully flattened!");
    }
    log2("✅ Assertion 2 Passed: Moyasar invoiceMetadata is 100% flattened strings/numbers.");

    const updatedDay = await SubscriptionDay.findById(day._id).lean();
    const updatedAddon = updatedDay.addonSelections.find(s => s.category === "snack");
    console.log("UPDATED ADDON:", updatedAddon);
    if (!updatedAddon.paymentId) {
      throw new Error("addonSelections were not updated with payment references!");
    }
    log2(`✅ Assertion 3 Passed: addonSelections successfully updated with paymentId ${updatedAddon.paymentId}.`);

    results.task2.status = "passed";

  } catch (err) {
    console.error("Test Error:", err);
    if (results.task1.status === "pending") results.task1.status = "failed";
    if (results.task2.status === "pending") results.task2.status = "failed";
  } finally {
    if (typeof loggerStub !== 'undefined') loggerStub.restore();
    await teardown();
    
    // Output JSON report
    const fs = require("fs");
    fs.writeFileSync("/home/hema/.gemini/antigravity/brain/fb0391f9-3da5-48bd-bdce-9f6284008300/scratch/e2e_report.json", JSON.stringify(results, null, 2));
    console.log("\n=== E2E Test Execution Summary ===");
    console.log(`Task 1: Addon Fixed Pricing Matrix => ${results.task1.status.toUpperCase()}`);
    console.log(`Task 2: Unified Day Payment Stability => ${results.task2.status.toUpperCase()}`);
  }
}

runTests();
