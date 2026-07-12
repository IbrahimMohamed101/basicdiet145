process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { seedCatalog } = require("../scripts/bootstrap/seed-catalog");
const Addon = require("../src/models/Addon");
const MenuProduct = require("../src/models/MenuProduct");
const AddonPlanPrice = require("../src/models/AddonPlanPrice");
const Plan = require("../src/models/Plan");

const { listAddonPlansAdmin, getAddonPlanAdmin } = require("../src/controllers/addonController");
const { listAddonPrices } = require("../src/controllers/addonPlanPriceController");

let mongoServer;

async function connect() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
}

function mockResponse() {
  return {
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
}

async function runTests() {
  await connect();
  try {
    console.log("--- 1. Running Catalog and Subscription Plans Bootstrap Seeding ---");
    await seedCatalog({ sync: true });

    console.log("--- 2. Verifying Seeded Menu Products and Plans ---");
    const orangeJuice = await MenuProduct.findOne({ key: "orange_juice" });
    assert.ok(orangeJuice, "Orange Juice MenuProduct should be seeded");
    assert.strictEqual(orangeJuice.itemType, "juice");
    assert.strictEqual(orangeJuice.priceHalala, 1000);

    const greekSalad = await MenuProduct.findOne({ key: "greek_salad" });
    assert.ok(greekSalad, "Greek Salad MenuProduct should be seeded");
    assert.strictEqual(greekSalad.itemType, "green_salad");

    const proteinSnack = await MenuProduct.findOne({ key: "protein_snack" });
    assert.ok(proteinSnack, "Protein Snack MenuProduct should be seeded");
    assert.strictEqual(proteinSnack.itemType, "dessert");

    const juiceSub = await Addon.findOne({ kind: "plan", category: "juice" });
    assert.ok(juiceSub, "Juice Subscription addon plan should be seeded");
    assert.strictEqual(juiceSub.type, "subscription");
    assert.strictEqual(juiceSub.maxPerDay, 1);
    assert.strictEqual(juiceSub.pricingMode, "base_plan_matrix");
    assert.ok(juiceSub.menuProductIds.includes(orangeJuice._id), "Juice plan should link to Orange Juice");
    assert.strictEqual(juiceSub.menuProductIds.length, 9);

    const base7Day = await Plan.findOne({ durationDays: 7 });
    assert.ok(base7Day, "7-Day base plan should be seeded");

    const matrixRow = await AddonPlanPrice.findOne({ addonPlanId: juiceSub._id, basePlanId: base7Day._id });
    assert.ok(matrixRow, "AddonPlanPrice matrix row should exist for Juice Sub + 7-Day Plan");
    assert.strictEqual(matrixRow.priceHalala, 10000);

    console.log("--- 2.5 Injecting internal test matrix row to verify filtering ---");
    const internalPlan = await Plan.create({
      key: "test_delivery_internal",
      name: { en: "Test Delivery Plan" },
      daysCount: 5,
      durationDays: 5,
      isActive: true,
      isAvailable: true,
      active: true,
      available: true
    });
    await AddonPlanPrice.create({ addonPlanId: juiceSub._id, basePlanId: internalPlan._id, priceHalala: 500, currency: "SAR", isActive: true });

    console.log("--- 3. Testing Dashboard Add-on Plans Read Models (GET /addon-plans) ---");
    const reqList = { query: {} };
    const resList = mockResponse();
    await listAddonPlansAdmin(reqList, resList);
    assert.strictEqual(resList.statusCode, 200);
    assert.ok(resList.data.status);
    const plansList = resList.data.data;
    assert.strictEqual(plansList.length, 3);
    const juiceListPlan = plansList.find(p => p.category === "juice");
    assert.strictEqual(juiceListPlan.menuProductsCount, 9);
    assert.strictEqual(juiceListPlan.pricingMode, "base_plan_matrix");
    assert.strictEqual(juiceListPlan.planPricesCount, 3, "planPricesCount should strictly count sellable base plans only");
    assert.strictEqual(juiceListPlan.priceHalala, undefined, "Legacy priceHalala should be stripped from top level");
    assert.strictEqual(juiceListPlan.priceSar, undefined, "Legacy priceSar should be stripped from top level");
    assert.ok(juiceListPlan.legacyCompatibility, "legacyCompatibility object should exist");
    assert.strictEqual(juiceListPlan.legacyCompatibility.priceHalala, 1100, "legacyCompatibility should retain the value");

    console.log("--- 4. Testing Dashboard Add-on Plan Detail Read Model (GET /addon-plans/:id) ---");
    const reqDetail = { params: { id: juiceSub._id.toString() } };
    const resDetail = mockResponse();
    await getAddonPlanAdmin(reqDetail, resDetail);
    assert.strictEqual(resDetail.statusCode, 200);
    assert.ok(resDetail.data.status);
    const detailData = resDetail.data.data;
    assert.strictEqual(detailData.id, juiceSub._id.toString());
    assert.strictEqual(detailData.pricingMode, "base_plan_matrix");
    assert.strictEqual(detailData.menuProductsCount, 9);
    assert.strictEqual(detailData.priceHalala, undefined, "Legacy priceHalala should be stripped from top level");
    assert.ok(detailData.legacyCompatibility, "legacyCompatibility should exist on detail");
    assert.strictEqual(detailData.legacyCompatibility.priceHalala, 1100);
    assert.strictEqual(detailData.menuProducts.length, 9);
    assert.strictEqual(detailData.menuProducts[0].name.en, "Orange Juice");
    assert.strictEqual(detailData.planPricesCount, 3);
    assert.strictEqual(detailData.planPrices.length, 3);
    const detailPrice7Day = detailData.planPrices.find(p => p.daysCount === 7);
    assert.ok(detailPrice7Day.id, "planPrices row must contain id");
    assert.ok(detailPrice7Day._id, "planPrices row must contain _id");
    assert.ok(detailPrice7Day.addonPlanId, "planPrices row must contain addonPlanId");
    assert.strictEqual(detailPrice7Day.priceHalala, 10000);
    assert.strictEqual(detailPrice7Day.priceSar, 100);
    assert.strictEqual(detailPrice7Day.priceLabel, "100 SAR");
    assert.strictEqual(detailPrice7Day.mealsCount, 14);

    console.log("--- 5. Testing Dashboard Addon Prices Read Model (GET /addon-prices) ---");
    const reqPrices = { query: {} };
    const resPrices = mockResponse();
    await listAddonPrices(reqPrices, resPrices);
    assert.strictEqual(resPrices.statusCode, 200);
    assert.ok(resPrices.data.status);
    const pricesList = resPrices.data.data;
    assert.ok(pricesList.length >= 9, "Should have seeded pricing matrix rows");
    const priceRowObj = pricesList.find(p => String(p.addonPlanId) === juiceSub._id.toString() && p.daysCount === 7);
    assert.ok(priceRowObj, "Should find Juice Sub + 7-Day row");
    assert.strictEqual(priceRowObj.priceHalala, 10000);
    assert.strictEqual(priceRowObj.mealsCount, 14);

    const internalRowObj = pricesList.find(p => String(p.basePlanId) === internalPlan._id.toString());
    assert.strictEqual(internalRowObj, undefined, "Internal plans should be excluded by default");

    const reqPricesInternal = { query: { includeInternal: "true" } };
    const resPricesInternal = mockResponse();
    await listAddonPrices(reqPricesInternal, resPricesInternal);
    const internalRowObjIncluded = resPricesInternal.data.data.find(p => String(p.basePlanId) === internalPlan._id.toString());
    assert.ok(internalRowObjIncluded, "Internal plans should be included when includeInternal=true is passed");

    console.log("--- 6. Testing Seeding Idempotency (Running seedCatalog twice) ---");
    const initialProductCount = await MenuProduct.countDocuments();
    const initialAddonCount = await Addon.countDocuments();
    const initialPriceCount = await AddonPlanPrice.countDocuments();

    // Run seed again
    await seedCatalog({ sync: true });

    const postProductCount = await MenuProduct.countDocuments();
    const postAddonCount = await Addon.countDocuments();
    // Re-create internal test price row since seedCatalog deactivates/cleans non-sellable rows
    await AddonPlanPrice.create({ addonPlanId: juiceSub._id, basePlanId: internalPlan._id, priceHalala: 500, currency: "SAR", isActive: true });
    const postPriceCount = await AddonPlanPrice.countDocuments();

    assert.strictEqual(postProductCount, initialProductCount, "Product count must not double on second seed run");
    assert.strictEqual(postAddonCount, initialAddonCount, "Addon count must not double on second seed run");
    assert.strictEqual(postPriceCount, initialPriceCount, "AddonPlanPrice count must not double on second seed run");

    console.log("--- 7. Testing Customer-Facing GET /addons/options Endpoint ---");
    const { getAddonSubscriptionOptions } = require("../src/controllers/addonController");
    const reqCustOpts = { query: { planId: base7Day._id.toString() } };
    const resCustOpts = mockResponse();
    await getAddonSubscriptionOptions(reqCustOpts, resCustOpts);

    assert.strictEqual(resCustOpts.statusCode, 200);
    assert.ok(resCustOpts.data.status);
    const custOpts = resCustOpts.data.data.addons;
    assert.strictEqual(custOpts.length, 3, "Should return all 3 seeded addon plans");

    const juiceOpt = custOpts.find(o => o.category === "juice");
    assert.ok(juiceOpt);
    assert.strictEqual(juiceOpt.priceHalala, 10000, "Juice matrix price for 7-day must be 10000");
    assert.strictEqual(juiceOpt.priceSar, 100);
    assert.strictEqual(juiceOpt.priceLabel, "100 SAR");
    assert.strictEqual(juiceOpt.pricingMode, "base_plan_matrix");
    assert.strictEqual(juiceOpt.maxPerDay, 1);
    assert.strictEqual(juiceOpt.menuProductsCount, 9);
    assert.ok(juiceOpt.menuProducts.find(p => p.name.en === "Orange Juice"), "Should contain Orange Juice in menuProducts");

    const snackOpt = custOpts.find(o => o.category === "snack");
    assert.ok(snackOpt);
    assert.strictEqual(snackOpt.priceHalala, 8000, "Snack matrix price for 7-day must be 8000");

    const saladOpt = custOpts.find(o => o.category === "small_salad");
    assert.ok(saladOpt);
    assert.strictEqual(saladOpt.priceHalala, 9000, "Small salad matrix price for 7-day must be 9000");
    const greekSaladProd = saladOpt.menuProducts.find(p => p.key === "greek_salad");
    assert.ok(greekSaladProd, "Small Salad Subscription must include Greek Salad");
    assert.strictEqual(greekSaladProd.isActive, true, "Greek Salad must be active");

    console.log("--- 7.5 Testing Daily selection validation ---");
    const { reconcileAddonInclusions } = require("../src/services/subscription/subscriptionSelectionService");
    const { resolveAddonChoiceProductById } = require("../src/services/subscription/subscriptionAddonChoicesService");

    const saladSubDoc = await Addon.findOne({ kind: "plan", category: "small_salad" });
    const greekSaladDoc = await MenuProduct.findOne({ key: "greek_salad" });
    const greenSaladDoc = await MenuProduct.findOne({ key: "green_salad" });
    const disallowedDoc = await MenuProduct.findOne({ key: "greek_yogurt" });

    const clientSub = {
      addonSubscriptions: [
        {
          addonId: saladSubDoc._id,
          category: "small_salad",
          name: "Small Salad Subscription",
          maxPerDay: 1,
          menuProductIds: saladSubDoc.menuProductIds,
        }
      ],
      addonBalance: [
        {
          addonId: saladSubDoc._id,
          category: "small_salad",
          remainingQty: 7,
        }
      ]
    };

    // Daily selection validation accepts Greek Salad
    const selectionDay = { addonSelections: [] };
    await reconcileAddonInclusions(
      clientSub,
      selectionDay,
      [greekSaladDoc._id.toString()],
      { resolveChoiceProductById: resolveAddonChoiceProductById }
    );
    assert.strictEqual(selectionDay.addonSelections.length, 1);
    assert.strictEqual(String(selectionDay.addonSelections[0].addonId), String(greekSaladDoc._id));
    assert.strictEqual(selectionDay.addonSelections[0].source, "subscription");
    assert.strictEqual(selectionDay.addonSelections[0].priceHalala, 0);

    // Green salad is outside the entitlement but a valid daily addon, so it falls back to paid
    const paidSelectionDay = { addonSelections: [] };
    await reconcileAddonInclusions(
      clientSub,
      paidSelectionDay,
      [greenSaladDoc._id.toString()],
      { resolveChoiceProductById: resolveAddonChoiceProductById }
    );
    assert.strictEqual(paidSelectionDay.addonSelections.length, 1);
    assert.strictEqual(String(paidSelectionDay.addonSelections[0].addonId), String(greenSaladDoc._id));
    assert.strictEqual(paidSelectionDay.addonSelections[0].source, "pending_payment");
    assert.strictEqual(paidSelectionDay.addonSelections[0].priceHalala, 1500);

    // Daily selection validation rejects products outside the mapping category
    const invalidSelectionDay = { addonSelections: [] };
    try {
      await reconcileAddonInclusions(
        clientSub,
        invalidSelectionDay,
        [disallowedDoc._id.toString()],
        { resolveChoiceProductById: resolveAddonChoiceProductById }
      );
      assert.fail("Should have rejected yogurt for small salad subscription");
    } catch (err) {
      assert.strictEqual(err.code, "INVALID_ONE_TIME_ADDON_SELECTION");
    }

    console.log("--- 8. Testing Quote Matrix Price Resolution ---");
    const { resolveCheckoutQuoteOrThrow } = require("../src/services/subscription/subscriptionQuoteService");
    const quotePayload = {
      planId: base7Day._id,
      grams: 100,
      mealsPerDay: 2,
      startDate: new Date(Date.now() + 86400000 * 2).toISOString(),
      addons: [
        { id: juiceSub._id }
      ],
      delivery: {
        type: "delivery",
        address: { street: "Test Street", city: "Riyadh" },
        zoneId: new mongoose.Types.ObjectId(),
        slot: { slotId: "delivery_slot_1", window: "09:00 - 12:00" },
      },
    };

    // Mock dependencies/settings required for quote
    const Setting = require("../src/models/Setting");
    await Setting.findOneAndUpdate(
      { key: "vat_rate" },
      { $set: { value: 0.15 } },
      { upsert: true }
    );
    await Setting.findOneAndUpdate(
      { key: "delivery_windows" },
      { $set: { value: ["09:00 - 12:00"] } },
      { upsert: true }
    );
    const Zone = require("../src/models/Zone");
    await Zone.create({
      _id: quotePayload.delivery.zoneId,
      name: { en: "Test Zone", ar: "منطقة اختبار" },
      deliveryFeeHalala: 0,
      isActive: true,
    });

    const quoteResult = await resolveCheckoutQuoteOrThrow(quotePayload, {
      enforceActivePlan: true,
      allowMissingDeliveryAddress: true,
      lang: "en",
    });
    
    assert.strictEqual(quoteResult.breakdown.addonsTotalHalala, 10000, "Quote must resolve flat matrix price");
    assert.strictEqual(quoteResult.addonSubscriptions.length, 1);
    assert.strictEqual(quoteResult.addonSubscriptions[0].priceHalala, 10000);
    assert.strictEqual(quoteResult.addonSubscriptions[0].name, "Juice Subscription");

    console.log("--- 9. Testing Direct Menu Item Purchases Remains Unaffected ---");
    const orangeJuiceDoc = await MenuProduct.findOne({ key: "orange_juice" });
    assert.ok(orangeJuiceDoc);
    assert.strictEqual(orangeJuiceDoc.priceHalala, 1000, "Direct price must remain 1000 halala");

    console.log("All catalog bootstrap and read model verification tests passed successfully!");
  } catch (err) {
    console.error("Test failed:", err);
    process.exit(1);
  } finally {
    await disconnect();
  }
}

runTests();

