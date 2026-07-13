process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const AddonPlanPrice = require("../src/models/AddonPlanPrice");
const Addon = require("../src/models/Addon");
const Plan = require("../src/models/Plan");
const MenuProduct = require("../src/models/MenuProduct");
const MenuCategory = require("../src/models/MenuCategory");

const { listAddonPrices, createAddonPrice, updateAddonPrice, deleteAddonPrice, toggleAddonPriceActive } = require("../src/controllers/addonPlanPriceController");
const { listAddons, getAddonSubscriptionOptions } = require("../src/controllers/addonController");
const { getSubscriptionMenu } = require("../src/controllers/menuController");
const { resolveCheckoutQuoteOrThrow } = require("../src/services/subscription/subscriptionQuoteService");
const { reconcileAddonInclusions } = require("../src/services/subscription/subscriptionSelectionService");
const { buildAddonChoicesCatalog } = require("../src/services/subscription/subscriptionAddonChoicesService");

let mongoServer;

async function connect() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri(`addon_matrix_test_${Date.now()}`);
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
}

// Helper to create express response mocks
function mockResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    data: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(obj) {
      this.data = obj;
      return this;
    },
  };
  return res;
}

async function runTests() {
  await connect();
  try {
    console.log("--- 1. Testing Models & Schema Validation ---");
    const addonPlanId = new mongoose.Types.ObjectId();
    const basePlanId = new mongoose.Types.ObjectId();

    // Create a matrix price row
    const row = await AddonPlanPrice.create({
      addonPlanId,
      basePlanId,
      priceHalala: 1500,
      isActive: true,
    });
    assert.strictEqual(row.priceHalala, 1500);
    assert.strictEqual(row.isActive, true);

    // Try creating duplicate active combination
    try {
      await AddonPlanPrice.create({
        addonPlanId,
        basePlanId,
        priceHalala: 2000,
        isActive: true,
      });
      assert.fail("Should have thrown duplicate key error");
    } catch (err) {
      assert.ok(err.message.includes("duplicate") || err.code === 11000, "Should be duplicate key error");
    }

    // Try creating active price for another addon/plan - should succeed
    const otherRow = await AddonPlanPrice.create({
      addonPlanId: new mongoose.Types.ObjectId(),
      basePlanId,
      priceHalala: 2500,
      isActive: true,
    });
    assert.strictEqual(otherRow.priceHalala, 2500);

    console.log("--- 2. Testing Controller CRUD Endpoints ---");
    // Setup actual base Plan and Addon docs for population tests
    const basePlan = await Plan.create({
      name: { en: "Base 30 Days", ar: "30 يوم" },
      daysCount: 30,
      currency: "SAR",
      isActive: true,
      gramsOptions: [{ grams: 150, isActive: true, mealsOptions: [{ mealsPerDay: 3, priceHalala: 120000, compareAtHalala: 120000, isActive: true }] }],
    });

    const addonPlan = await Addon.create({
      name: { en: "Snack Plan", ar: "سناك" },
      category: "snack",
      kind: "plan",
      billingMode: "per_day",
      priceHalala: 1000,
      maxPerDay: 2,
      isActive: true,
    });

    // Create via controller
    const resCreate = mockResponse();
    await createAddonPrice(
      {
        body: {
          addonPlanId: addonPlan._id,
          basePlanId: basePlan._id,
          priceHalala: 950,
          isActive: true,
        },
      },
      resCreate
    );
    assert.strictEqual(resCreate.statusCode, 201);
    assert.strictEqual(resCreate.data.status, true);
    assert.strictEqual(resCreate.data.data.priceHalala, 950);
    assert.strictEqual(resCreate.data.data.priceLabel, "9.5 SAR");

    const createdRowId = resCreate.data.data._id;

    // List via controller
    const resList = mockResponse();
    await listAddonPrices({ query: { includeInternal: "true" } }, resList);
    assert.strictEqual(resList.statusCode, 200);
    assert.ok(resList.data.data.length >= 1);
    const listed = resList.data.data.find(r => String(r._id) === String(createdRowId));
    assert.ok(listed);
    assert.strictEqual(listed.basePlanName.en, "Base 30 Days");
    assert.strictEqual(listed.addonPlanName.en, "Snack Plan");

    // Toggle active status
    const resToggle = mockResponse();
    await toggleAddonPriceActive({ params: { id: createdRowId } }, resToggle);
    assert.strictEqual(resToggle.statusCode, 200);
    assert.strictEqual(resToggle.data.data.isActive, false);

    // Toggle back to active
    const resToggle2 = mockResponse();
    await toggleAddonPriceActive({ params: { id: createdRowId } }, resToggle2);
    assert.strictEqual(resToggle2.statusCode, 200);
    assert.strictEqual(resToggle2.data.data.isActive, true);

    // Update price
    const resUpdate = mockResponse();
    await updateAddonPrice(
      {
        params: { id: createdRowId },
        body: { priceHalala: 800 },
      },
      resUpdate
    );
    assert.strictEqual(resUpdate.statusCode, 200);
    assert.strictEqual(resUpdate.data.data.priceHalala, 800);

    // Seed Zone and Delivery Window Settings
    const Zone = require("../src/models/Zone");
    const Setting = require("../src/models/Setting");
    const testZone = await Zone.create({
      name: { en: "Test Zone", ar: "منطقة اختبار" },
      deliveryFeeHalala: 0,
      isActive: true,
    });
    await Setting.findOneAndUpdate(
      { key: "delivery_windows" },
      { $set: { value: ["09:00 - 12:00", "12:00 - 15:00"] } },
      { upsert: true, new: true }
    );

    console.log("--- 3. Testing Quote Resolution and Pricing Matrix ---");
    // Resolve quote using pricing matrix price (800 halala per day)
    const quotePayload = {
      planId: basePlan._id,
      grams: 150,
      mealsPerDay: 3,
      startDate: new Date(Date.now() + 86400000 * 2).toISOString(),
      addons: [{ id: addonPlan._id }],
      delivery: {
        type: "delivery",
        address: { street: "Test Street", city: "Riyadh" },
        zoneId: testZone._id,
        slot: { slotId: "delivery_slot_1", window: "09:00 - 12:00" },
      },
    };

    const resolvedQuote = await resolveCheckoutQuoteOrThrow(quotePayload, {
      enforceActivePlan: true,
      allowMissingDeliveryAddress: true,
    });
    // Base plan price: 120000. Addon: 800 flat. Delivery = 0. Total = 120800.
    assert.strictEqual(resolvedQuote.breakdown.addonsTotalHalala, 800);
    assert.strictEqual(resolvedQuote.addonSubscriptions[0].priceHalala, 800);
    assert.strictEqual(resolvedQuote.addonSubscriptions[0].maxPerDay, 2);
    assert.strictEqual(resolvedQuote.addonSubscriptions[0].priceSource, "base_plan_addon_price");
    assert.strictEqual(resolvedQuote.addonSubscriptions[0].quantityPerDay, 1);
    assert.strictEqual(resolvedQuote.addonSubscriptions[0].includedTotalQty, 30);
    assert.strictEqual(resolvedQuote.addonBalance[0].purchasedDailyQty, 1);
    assert.strictEqual(resolvedQuote.addonBalance[0].includedTotalQty, 30);
    assert.strictEqual(resolvedQuote.addonBalance[0].purchasedQty, 30);
    assert.strictEqual(resolvedQuote.addonBalance[0].remainingQty, 30);

    const quantityQuote = await resolveCheckoutQuoteOrThrow(
      { ...quotePayload, addons: [{ addonPlanId: addonPlan._id, quantityPerDay: 2 }] },
      {
        enforceActivePlan: true,
        allowMissingDeliveryAddress: true,
      }
    );
    assert.strictEqual(quantityQuote.breakdown.addonsTotalHalala, 1600);
    assert.strictEqual(quantityQuote.addonSubscriptions[0].quantityPerDay, 2);
    assert.strictEqual(quantityQuote.addonSubscriptions[0].includedTotalQty, 60);
    assert.strictEqual(quantityQuote.addonBalance[0].purchasedQty, 60);
    assert.strictEqual(quantityQuote.addonBalance[0].remainingQty, 60);

    for (const invalidQty of [0, -1, 1.5, "2"]) {
      try {
        await resolveCheckoutQuoteOrThrow(
          { ...quotePayload, addons: [{ addonPlanId: addonPlan._id, quantityPerDay: invalidQty }] },
          {
            enforceActivePlan: true,
            allowMissingDeliveryAddress: true,
          }
        );
        assert.fail(`Should have rejected invalid quantity ${invalidQty}`);
      } catch (err) {
        assert.strictEqual(err.code, "VALIDATION_ERROR");
      }
    }

    // Test quote failure when pricing matrix row is missing
    await AddonPlanPrice.deleteOne({ _id: createdRowId });
    try {
      await resolveCheckoutQuoteOrThrow(quotePayload, {
        enforceActivePlan: true,
        allowMissingDeliveryAddress: true,
      });
      assert.fail("Should have failed quote resolution without matrix row");
    } catch (err) {
      assert.strictEqual(err.code, "PRICE_MATRIX_NOT_FOUND");
    }

    // Recreate matrix price for downstream tests
    await AddonPlanPrice.create({
      addonPlanId: addonPlan._id,
      basePlanId: basePlan._id,
      priceHalala: 800,
      isActive: true,
    });

    console.log("--- 4. Testing Selection Allowed Products Validation ---");
    const menuCategory = await MenuCategory.create({
      key: "desserts",
      name: { en: "Desserts", ar: "Desserts" },
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: new Date(),
    });

    const allowedProduct = await MenuProduct.create({
      categoryId: menuCategory._id,
      key: "brownie",
      name: { en: "Healthy Brownie", ar: "Healthy Brownie" },
      priceHalala: 1500,
      availableFor: ["one_time"],
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: new Date(),
    });

    const forbiddenProduct = await MenuProduct.create({
      categoryId: menuCategory._id,
      key: "cookie",
      name: { en: "Oat Cookie", ar: "Oat Cookie" },
      priceHalala: 1200,
      availableFor: ["one_time"],
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: new Date(),
    });

    // Entitlement with menuProductIds constraint containing only allowedProduct
    const subscription = {
      _id: new mongoose.Types.ObjectId(),
      addonSubscriptions: [
        {
          addonId: addonPlan._id,
          name: "Snack Plan",
          category: "snack",
          maxPerDay: 1,
          menuProductIds: [allowedProduct._id],
        },
      ],
      addonBalance: [
        {
          _id: new mongoose.Types.ObjectId(),
          addonId: addonPlan._id,
          category: "snack",
          remainingQty: 7,
        },
      ],
    };

    // Valid selection (allowedProduct)
    const day1 = { addonSelections: [] };
    await reconcileAddonInclusions(
      subscription,
      day1,
      [String(allowedProduct._id)],
      {
        resolveChoiceProductById: async (id) => {
          if (id === String(allowedProduct._id)) {
            return { product: allowedProduct, addonCategory: "snack" };
          }
          return null;
        },
      }
    );
    assert.strictEqual(day1.addonSelections.length, 1);
    assert.strictEqual(day1.addonSelections[0].source, "subscription");
    assert.strictEqual(day1.addonSelections[0].priceHalala, 0);

    const flexDay = { addonSelections: [] };
    await reconcileAddonInclusions(
      subscription,
      flexDay,
      [
        String(allowedProduct._id),
        String(allowedProduct._id),
        String(allowedProduct._id),
        String(allowedProduct._id),
        String(allowedProduct._id),
        String(allowedProduct._id),
      ],
      {
        resolveChoiceProductById: async (id) => {
          if (id === String(allowedProduct._id)) {
            return { product: allowedProduct, addonCategory: "snack" };
          }
          return null;
        },
      }
    );
    assert.strictEqual(flexDay.addonSelections.length, 6);
    assert.ok(flexDay.addonSelections.every((selection) => selection.source === "subscription"));
    assert.ok(flexDay.addonSelections.every((selection) => selection.priceHalala === 0));

    // Overage selection (remainingQty = 1, requested = 6)
    const overageSub = {
      _id: new mongoose.Types.ObjectId(),
      addonSubscriptions: [
        {
          addonId: addonPlan._id,
          name: "Snack Plan",
          category: "snack",
          maxPerDay: 1,
          menuProductIds: [allowedProduct._id],
        },
      ],
      addonBalance: [
        {
          _id: new mongoose.Types.ObjectId(),
          addonId: addonPlan._id,
          category: "snack",
          remainingQty: 1,
        },
      ],
    };

    const overageDay = { addonSelections: [] };
    await reconcileAddonInclusions(
      overageSub,
      overageDay,
      [
        String(allowedProduct._id),
        String(allowedProduct._id),
        String(allowedProduct._id),
        String(allowedProduct._id),
        String(allowedProduct._id),
        String(allowedProduct._id),
      ],
      {
        resolveChoiceProductById: async (id) => {
          if (id === String(allowedProduct._id)) {
            return { product: allowedProduct, addonCategory: "snack" };
          }
          return null;
        },
      }
    );
    assert.strictEqual(overageDay.addonSelections.length, 6);
    assert.strictEqual(overageDay.addonSelections[0].source, "subscription");
    assert.strictEqual(overageDay.addonSelections[0].priceHalala, 0);
    for (let i = 1; i < 6; i++) {
      assert.strictEqual(overageDay.addonSelections[i].source, "pending_payment");
      assert.strictEqual(overageDay.addonSelections[i].priceHalala, 1500);
    }

    // Invalid selection (forbiddenProduct) - should fall through to pending_payment, not reject
    const day2 = { addonSelections: [] };
    await reconcileAddonInclusions(
      subscription,
      day2,
      [String(forbiddenProduct._id)],
      {
        resolveChoiceProductById: async (id) => {
          if (id === String(forbiddenProduct._id)) {
            return { product: forbiddenProduct, addonCategory: "juice" };
          }
          return null;
        },
      }
    );
    assert.strictEqual(day2.addonSelections.length, 1);
    assert.strictEqual(day2.addonSelections[0].source, "pending_payment");
    assert.strictEqual(day2.addonSelections[0].priceHalala, 1200);

    console.log("--- 5. Testing Catalog Filtering by subscriptionId ---");
    // Re-save subscription to DB to test buildAddonChoicesCatalog
    const Subscription = mongoose.model("Subscription");
    const subDoc = await Subscription.create({
      userId: new mongoose.Types.ObjectId(),
      planId: basePlan._id,
      status: "active",
      startDate: new Date(),
      endDate: new Date(),
      totalMeals: 30,
      remainingMeals: 30,
      deliveryMode: "delivery",
      addonSubscriptions: [
        {
          addonId: addonPlan._id,
          name: "Snack Plan",
          category: "snack",
          maxPerDay: 1,
          menuProductIds: [allowedProduct._id],
        },
      ],
    });

    const choicesCatalog = await buildAddonChoicesCatalog({
      category: "snack",
      subscriptionId: subDoc._id,
      models: {
        MenuProductModel: MenuProduct,
        MenuCategoryModel: MenuCategory,
      },
    });

    const snackChoices = choicesCatalog.snack.choices;
    const allowedChoice = snackChoices.find(c => String(c.id) === String(allowedProduct._id));
    const forbiddenChoice = snackChoices.find(c => String(c.id) === String(forbiddenProduct._id));
    assert.ok(allowedChoice, "allowedProduct should be in choices");
    assert.ok(forbiddenChoice, "forbiddenProduct should be in choices");
    assert.strictEqual(allowedChoice.isEligibleForAllowance, true);
    assert.strictEqual(forbiddenChoice.isEligibleForAllowance, true,
      "All mapped snack products are eligible while the subscription has snack credits");

    console.log("--- 5.5 Regression Test: Customer checkout quote resolves flat pricing matrix price without multiplying by days ---");
    const regBasePlanId = "6a2454c04a2465a2f7a07800";
    const regAddonPlanId = "6a2454b24a2465a2f7a0778e";

    const regBasePlan = await Plan.findOneAndUpdate(
      { _id: regBasePlanId },
      {
        $set: {
          name: { en: "7-Day Base Plan", ar: "7 أيام" },
          daysCount: 7,
          currency: "SAR",
          isActive: true,
          gramsOptions: [{ grams: 150, isActive: true, mealsOptions: [{ mealsPerDay: 2, priceHalala: 27600, compareAtHalala: 27600, isActive: true }] }],
        }
      },
      { upsert: true, new: true }
    );

    const regAddonPlan = await Addon.findOneAndUpdate(
      { _id: regAddonPlanId },
      {
        $set: {
          name: { en: "Juice Subscription", ar: "عصير" },
          category: "juice",
          kind: "plan",
          billingMode: "per_day",
          pricingMode: "base_plan_matrix",
          priceHalala: 1100, // legacy
          maxPerDay: 1,
          isActive: true,
        }
      },
      { upsert: true, new: true }
    );

    // Seed matrix row: Juice Subscription + 7-Day Plan = 10000 halala
    await AddonPlanPrice.findOneAndUpdate(
      { addonPlanId: regAddonPlan._id, basePlanId: regBasePlan._id },
      { $set: { priceHalala: 10000, isActive: true } },
      { upsert: true }
    );

    const regQuotePayload = {
      planId: regBasePlan._id,
      grams: 150,
      mealsPerDay: 2,
      startDate: new Date(Date.now() + 86400000 * 2).toISOString(),
      addons: [{ id: regAddonPlan._id }],
      delivery: {
        type: "delivery",
        address: { street: "Test Street", city: "Riyadh" },
        zoneId: testZone._id,
        slot: { slotId: "delivery_slot_1", window: "09:00 - 12:00" },
      },
    };

    const regQuote = await resolveCheckoutQuoteOrThrow(regQuotePayload, {
      enforceActivePlan: true,
      allowMissingDeliveryAddress: true,
    });

    // Assertions
    assert.strictEqual(regQuote.breakdown.addonsTotalHalala, 10000);
    assert.strictEqual(regQuote.addonSubscriptions[0].priceHalala, 10000);
    assert.strictEqual(regQuote.addonSubscriptions[0].priceSource, "base_plan_addon_price");
    assert.strictEqual(regQuote.addonSubscriptions[0].pricingMode || regAddonPlan.pricingMode, "base_plan_matrix");
    // Verify that legacy calculation (1100 * 7 = 7700) was NOT used
    assert.notStrictEqual(regQuote.breakdown.addonsTotalHalala, 7700);

    // Verify missing matrix price returns PRICE_MATRIX_NOT_FOUND error
    await AddonPlanPrice.deleteOne({ addonPlanId: regAddonPlan._id, basePlanId: regBasePlan._id });
    try {
      await resolveCheckoutQuoteOrThrow(regQuotePayload, {
        enforceActivePlan: true,
        allowMissingDeliveryAddress: true,
      });
      assert.fail("Should have failed quote resolution without matrix row");
    } catch (err) {
      assert.strictEqual(err.code, "PRICE_MATRIX_NOT_FOUND");
    }

    console.log("--- 6. Testing Public Addon Lists Matrix Price Integration ---");
    // Public addon listing filter mock request
    const resAddons = mockResponse();
    await listAddons(
      {
        query: { basePlanId: String(basePlan._id) },
      },
      resAddons
    );
    assert.strictEqual(resAddons.statusCode, 200);
    const snackPlanEntry = resAddons.data.data.find(a => String(a.id) === String(addonPlan._id));
    assert.ok(snackPlanEntry);
    assert.strictEqual(snackPlanEntry.priceHalala, 800);
    assert.strictEqual(snackPlanEntry.priceLabel, "8 SAR");

    // Subscription Menu endpoint mock request
    const resMenu = mockResponse();
    await getSubscriptionMenu(
      {
        query: { basePlanId: String(basePlan._id) },
      },
      resMenu
    );
    assert.strictEqual(resMenu.statusCode, 200);
    const menuSnackPlan = resMenu.data.data.addons.find(a => String(a.id) === String(addonPlan._id));
    assert.ok(menuSnackPlan);
    assert.strictEqual(menuSnackPlan.priceHalala, 800);

    console.log("--- 7. Testing Customer-Facing Addon Options Endpoint ---");

    // 7a) Valid planId returns only plan addons with active matrix prices
    const resOpts1 = mockResponse();
    await getAddonSubscriptionOptions(
      { query: { planId: String(basePlan._id) } },
      resOpts1
    );
    assert.strictEqual(resOpts1.statusCode, 200);
    assert.strictEqual(resOpts1.data.status, true);
    assert.strictEqual(resOpts1.data.data.planId, String(basePlan._id));
    assert.ok(Array.isArray(resOpts1.data.data.addons));
    const optsSnack = resOpts1.data.data.addons.find(a => String(a.id) === String(addonPlan._id));
    assert.ok(optsSnack, "Snack Plan should appear in options");
    assert.strictEqual(optsSnack.priceHalala, 800, "Price must be matrix price, not legacy");
    assert.strictEqual(optsSnack.priceSar, 8);
    assert.strictEqual(optsSnack.priceLabel, "8 SAR");
    assert.strictEqual(optsSnack.pricingMode, "base_plan_matrix");
    assert.strictEqual(optsSnack.isAvailable, true);
    assert.strictEqual(optsSnack.addonPlanId, String(addonPlan._id));
    assert.ok(optsSnack.name);
    assert.ok(optsSnack.category);
    assert.ok(Array.isArray(optsSnack.menuProductIds));
    assert.ok(Array.isArray(optsSnack.menuProducts));
    assert.strictEqual(typeof optsSnack.menuProductsCount, "number");

    // 7b) Legacy priceHalala (1000) must NOT appear
    assert.notStrictEqual(optsSnack.priceHalala, 1000, "Must not return legacy addon priceHalala");

    // 7c) Regression: Juice + 7-Day Plan returns 10000
    // Re-seed matrix row that was deleted in step 5.5
    await AddonPlanPrice.findOneAndUpdate(
      { addonPlanId: regAddonPlan._id, basePlanId: regBasePlan._id },
      { $set: { priceHalala: 10000, isActive: true } },
      { upsert: true }
    );
    const resOpts2 = mockResponse();
    await getAddonSubscriptionOptions(
      { query: { planId: String(regBasePlan._id) } },
      resOpts2
    );
    assert.strictEqual(resOpts2.statusCode, 200);
    const optsJuice = resOpts2.data.data.addons.find(a => String(a.id) === String(regAddonPlan._id));
    assert.ok(optsJuice, "Juice Subscription should appear for 7-Day plan");
    assert.strictEqual(optsJuice.priceHalala, 10000);
    assert.strictEqual(optsJuice.priceSar, 100);
    assert.strictEqual(optsJuice.priceLabel, "100 SAR");
    // Must NOT return legacy 1100 or multiplied 7700
    assert.notStrictEqual(optsJuice.priceHalala, 1100);
    assert.notStrictEqual(optsJuice.priceHalala, 7700);

    // 7d) Missing planId returns 400
    const resOpts3 = mockResponse();
    await getAddonSubscriptionOptions(
      { query: {} },
      resOpts3
    );
    assert.strictEqual(resOpts3.statusCode, 400);

    // 7e) Invalid planId returns 400
    const resOpts4 = mockResponse();
    await getAddonSubscriptionOptions(
      { query: { planId: "not-an-object-id" } },
      resOpts4
    );
    assert.strictEqual(resOpts4.statusCode, 400);

    // 7f) Non-existent planId returns 404
    const resOpts5 = mockResponse();
    await getAddonSubscriptionOptions(
      { query: { planId: String(new mongoose.Types.ObjectId()) } },
      resOpts5
    );
    assert.strictEqual(resOpts5.statusCode, 404);

    // 7g) Addons without matrix rows for a plan are excluded
    const isolatedPlan = await Plan.create({
      name: { en: "Isolated Plan", ar: "خطة معزولة" },
      daysCount: 5,
      currency: "SAR",
      isActive: true,
      gramsOptions: [{ grams: 100, isActive: true, mealsOptions: [{ mealsPerDay: 1, priceHalala: 5000, compareAtHalala: 5000, isActive: true }] }],
    });
    const resOpts6 = mockResponse();
    await getAddonSubscriptionOptions(
      { query: { planId: String(isolatedPlan._id) } },
      resOpts6
    );
    assert.strictEqual(resOpts6.statusCode, 200);
    assert.strictEqual(resOpts6.data.data.addons.length, 0, "No addons should appear for plan with no matrix rows");

    console.log("All addon subscription model matrix tests passed successfully!");
  } finally {
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
    await disconnect();
  }
}

runTests().catch(async (err) => {
  console.error(err);
  try { await disconnect(); } catch (_err) {}
  process.exit(1);
});
