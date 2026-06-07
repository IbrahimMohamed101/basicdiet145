require("dotenv").config();
const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const {
  VAT_PERCENTAGE,
  VAT_INCLUDED,
  getSystemVatPercentage,
  calculateVatBreakdownFromInclusiveTotal,
} = require("../src/config/vat");
const Setting = require("../src/models/Setting");
const { buildQuoteSnapshot } = require("../src/services/subscription/subscriptionQuoteService");
const { priceOrderCart } = require("../src/services/orders/orderPricingService");

let replSet;

async function setup() {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = replSet.getUri();
  await mongoose.connect(uri);
  console.log("Memory DB connected for VAT system tests");
}

async function teardown() {
  await mongoose.disconnect();
  await replSet.stop();
  console.log("Memory DB disconnected");
}

function verifyUnitTests() {
  console.log("Running VAT unit tests...");
  
  assert.strictEqual(VAT_PERCENTAGE, 16, "VAT_PERCENTAGE must be 16");
  assert.strictEqual(VAT_INCLUDED, true, "VAT_INCLUDED must be true");
  assert.strictEqual(getSystemVatPercentage(), 16, "getSystemVatPercentage must return 16");

  // Zero case
  const zero = calculateVatBreakdownFromInclusiveTotal(0);
  assert.strictEqual(zero.totalHalala, 0);
  assert.strictEqual(zero.vatHalala, 0);
  assert.strictEqual(zero.subtotalExcludingVatHalala, 0);

  // 1000 case -> round(1000 * 16 / 116) = 138
  const thousand = calculateVatBreakdownFromInclusiveTotal(1000);
  assert.strictEqual(thousand.totalHalala, 1000);
  assert.strictEqual(thousand.vatHalala, 138); // Math.round(137.93)
  assert.strictEqual(thousand.subtotalExcludingVatHalala, 862);

  // 11600 case -> 1600 vat, 10000 net
  const nice = calculateVatBreakdownFromInclusiveTotal(11600);
  assert.strictEqual(nice.totalHalala, 11600);
  assert.strictEqual(nice.vatHalala, 1600);
  assert.strictEqual(nice.subtotalExcludingVatHalala, 10000);

  console.log("VAT unit tests passed.");
}

async function verifyIntegrationTests() {
  console.log("Running VAT integration tests...");
  // Clear any existing settings (though DB is fresh)
  await Setting.deleteMany({});
  
  // Verify that an empty DB still yields 16% VAT in one-time orders
  const pricedOneTime = await priceOrderCart({
    userId: new mongoose.Types.ObjectId(),
    items: [],
    fulfillmentMethod: "pickup",
    pickup: {},
    delivery: {},
    lang: "en",
    requestBody: { items: [], fulfillmentMethod: "pickup" }
  });
  
  assert.strictEqual(pricedOneTime.pricing.vatPercentage, 16, "One time order must use 16% VAT naturally");
  assert.strictEqual(pricedOneTime.pricing.totalHalala, 0, "One time order inclusive total must match");
  assert.strictEqual(pricedOneTime.pricing.vatHalala, 0, "One time order vat must be computed from 16%");
  assert.strictEqual(pricedOneTime.pricing.subtotalHalala, 0, "One time order subtotal must equal total - vat");
  
  console.log("VAT integration tests passed.");
}

async function run() {
  try {
    verifyUnitTests();
    await setup();
    await verifyIntegrationTests();
    console.log("All VAT system tests passed successfully!");
  } catch (err) {
    console.error("Test failed:", err);
    process.exit(1);
  } finally {
    if (replSet) await teardown();
  }
}

run();
