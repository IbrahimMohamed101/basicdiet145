const mongoose = require("mongoose");
const { resolveCheckoutQuoteOrThrow } = require("./src/services/subscription/subscriptionQuoteService");
const { createUnifiedDayPaymentFlow } = require("./src/services/subscription/unifiedDayPaymentService");
const Plan = require("./src/models/Plan");
const Addon = require("./src/models/Addon");
const AddonPlanPrice = require("./src/models/AddonPlanPrice");
const SubscriptionDay = require("./src/models/SubscriptionDay");
const Subscription = require("./src/models/Subscription");
const Payment = require("./src/models/Payment");
const Zone = require("./src/models/Zone");

async function runTests() {
  await mongoose.connect("mongodb://localhost:27017/basicdiet145");
  console.log("Connected to DB...");

  const results = {
    task1: { status: "pending", logs: [] },
    task2: { status: "pending", logs: [] }
  };

  function log1(msg) { results.task1.logs.push(msg); console.log("[Task 1]", msg); }
  function log2(msg) { results.task2.logs.push(msg); console.log("[Task 2]", msg); }

  try {
    // --- Task 1 Setup ---
    log1("Setting up Task 1 test data...");
    
    // Create dummy zone
    const zone = new Zone({ name: { en: "Test Zone", ar: "منطقة تجربة" }, isActive: true });
    await zone.save();

    // Create a 30-day plan
    const plan = new Plan({
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
          priceHalala: 100000 // 1000 SAR
        }]
      }]
    });
    await plan.save();

    // Create a subscription Addon with base_plan_matrix mode
    const addon = new Addon({
      name: { en: "Small Salad 30 Days", ar: "سلطة صغيرة" },
      kind: "plan",
      category: "small_salad",
      pricingMode: "base_plan_matrix",
      priceHalala: 500, // Fallback/base price 5 SAR (should NOT be used or multiplied)
      isActive: true,
    });
    await addon.save();

    // Create AddonPlanPrice matrix entry mapping the 30-day plan to the Addon
    const exactFixedPrice = 27000; // 270 SAR
    const matrixPrice = new AddonPlanPrice({
      addonPlanId: addon._id,
      basePlanId: plan._id,
      priceHalala: exactFixedPrice,
      isActive: true
    });
    await matrixPrice.save();

    // Run the Quote Service
    log1(`Simulating checkout for Plan (30 days) + Addon Plan (matrix price: 270 SAR)`);
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

    // Note: Since delivery window checks might fail without mock settings, we'll mock Setting if needed.
    // Or we can just mock getSettingValue using sinon, but the DB already has settings in basicdiet145.
    // Let's try running it:
    try {
      const quote = await resolveCheckoutQuoteOrThrow(quotePayload, { allowMissingDeliveryAddress: true });
      log1(`Quote generated successfully!`);
      
      const quotedAddon = quote.addonItems.find(a => String(a.addonPlanId) === String(addon._id));
      
      if (!quotedAddon) throw new Error("Addon missing from quote");
      
      log1(`Addon Unit Price: ${quotedAddon.unitPriceHalala / 100} SAR`);
      log1(`Addon Total Price: ${quotedAddon.totalHalala / 100} SAR`);
      log1(`Expected Total Price: 270 SAR`);
      
      if (quotedAddon.totalHalala !== exactFixedPrice) {
        throw new Error(`Total price mismatch! Expected ${exactFixedPrice}, got ${quotedAddon.totalHalala}`);
      }
      
      results.task1.status = "passed";
      log1("✅ Task 1 Passed! Matrix fixed pricing applied without multiplication.");
    } catch (e) {
      log1(`❌ Task 1 Failed: ${e.message}`);
      results.task1.status = "failed";
    }

    // Cleanup Task 1
    await Zone.deleteOne({ _id: zone._id });
    await Plan.deleteOne({ _id: plan._id });
    await Addon.deleteOne({ _id: addon._id });
    await AddonPlanPrice.deleteOne({ _id: matrixPrice._id });


    // --- Task 2 Setup ---
    log2("Setting up Task 2 test data...");

    const sub = new Subscription({
      status: "active",
      clientId: new mongoose.Types.ObjectId(),
      planId: new mongoose.Types.ObjectId(),
    });
    await sub.save();

    const day = new SubscriptionDay({
      subscriptionId: sub._id,
      date: "2026-08-01",
      status: "pending",
      deliveryType: "delivery",
      addonSelections: [
        {
          id: "extra_snack_1",
          addonId: new mongoose.Types.ObjectId(),
          source: "pending_payment",
          status: "pending",
          qty: 1,
          priceHalala: 1500 // 15 SAR
        }
      ]
    });
    await day.save();

    log2(`Simulating createUnifiedDayPaymentFlow with missing redirectContext...`);
    const flowPayload = {
      subscriptionId: sub._id,
      date: "2026-08-01",
      checkoutAmountHalala: 1500, // The 15 SAR for the addon
      body: {
        // Omitting redirectContext to test null check
        // successUrl, backUrl missing as well
      }
    };

    // We need to mock the Moyasar provider to avoid a real HTTP request failing,
    // but createUnifiedDayPaymentFlow calls subscriptionPaymentPayloadService.
    // Let's stub the provider via overriding the required function if possible.
    // Actually, createUnifiedDayPaymentFlow creates the payment in DB and attempts to call provider.
    // Let's just let it run. If it fails, we check where it failed. If it returns 201 with an invoice, it works!
    // Since Moyasar uses an API key, we should mock the API key or endpoint to not actually hit Moyasar.
    
    // Instead of hitting Moyasar, we can use a Sinon stub on 'createProviderInvoice'
    const sinon = require("sinon");
    const checkoutService = require("./src/services/subscription/subscriptionCheckoutService");
    
    const mockMoyasarInvoice = {
      id: "inv_mock123",
      status: "initiated",
      url: "https://moyasar.com/mock-invoice"
    };

    const stub = sinon.stub(checkoutService, "createMoyasarInvoice").resolves(mockMoyasarInvoice);
    
    // Wait, createUnifiedDayPaymentFlow is inside unifiedDayPaymentService. 
    // It calls `buildProviderInvoicePayload` and sends it to the provider. 
    // Actually it uses `subscriptionCheckoutPaymentService` internally or just a provider adapter.
    // Let's mock the actual HTTP request or just let it fail at the API level but check the DB payload.
    // To be perfectly accurate, let's use nock to mock Moyasar.
    const nock = require("nock");
    let interceptedMetadata = null;
    nock('https://api.moyasar.com')
      .post('/v1/invoices')
      .reply((uri, requestBody) => {
        const body = typeof requestBody === 'string' ? JSON.parse(requestBody) : requestBody;
        interceptedMetadata = body.metadata;
        return [201, mockMoyasarInvoice];
      });

    try {
      const result = await createUnifiedDayPaymentFlow(flowPayload);
      log2(`Flow returned result code: ${result.code}`);

      if (result.code !== 201) {
         throw new Error(`Expected 201, got ${result.code}: ${result.message}`);
      }

      log2(`Moyasar API intercepted metadata: ${JSON.stringify(interceptedMetadata)}`);
      
      // Assertion 2: Metadata is completely flattened
      let hasNested = false;
      for (const key in interceptedMetadata) {
        if (typeof interceptedMetadata[key] === "object" && interceptedMetadata[key] !== null) {
          hasNested = true;
          log2(`❌ Metadata key '${key}' is a nested object/array!`);
        }
      }
      if (hasNested) throw new Error("Metadata contains nested objects");
      log2(`✅ Metadata is strictly flat.`);

      // Assertion 3: DB updated
      const updatedDay = await SubscriptionDay.findById(day._id).lean();
      const updatedAddon = updatedDay.addonSelections.find(s => s.id === "extra_snack_1");
      
      if (!updatedAddon.paymentId || !updatedAddon.providerInvoiceId) {
        throw new Error("Addon selection was not updated with paymentId/providerInvoiceId");
      }
      log2(`✅ Addon successfully linked to paymentId: ${updatedAddon.paymentId}`);
      
      results.task2.status = "passed";
      log2("✅ Task 2 Passed! Null checks succeeded, flat metadata sent, and DB linked.");
    } catch (e) {
      log2(`❌ Task 2 Failed: ${e.message}`);
      results.task2.status = "failed";
    } finally {
      nock.cleanAll();
      if (stub && stub.restore) stub.restore();
    }

    // Cleanup Task 2
    await Subscription.deleteOne({ _id: sub._id });
    await SubscriptionDay.deleteOne({ _id: day._id });
    await Payment.deleteMany({ subscriptionId: sub._id });

  } catch (err) {
    console.error("Critical Test Error:", err);
  } finally {
    await mongoose.disconnect();
    
    // Output JSON report
    const fs = require("fs");
    fs.writeFileSync("/home/hema/.gemini/antigravity/brain/fb0391f9-3da5-48bd-bdce-9f6284008300/scratch/e2e_report.json", JSON.stringify(results, null, 2));
    console.log("Report generated.");
  }
}

runTests();
