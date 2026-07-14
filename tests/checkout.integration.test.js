/**
 * Checkout Integration Tests
 * 
 * Tests the premium checkout → activation → current-overview cycle:
 * - Checkout with legacy premium IDs
 * - Checkout with canonical premium IDs
 * - Premium balance persisted correctly
 * - Current overview reflects correct totals
 * 
 * Run with: node tests/checkout.integration.test.js
 * Or: npm run test:checkout
 */

require('dotenv').config();

const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const http = require('http');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const moyasarService = require('../src/services/moyasarService');
let mockInvoiceSequence = 0;
moyasarService.createInvoice = async (payload) => {
  mockInvoiceSequence += 1;
  return {
    id: `inv_checkout_integration_${mockInvoiceSequence}`,
    url: `https://payments.example.test/checkout/${mockInvoiceSequence}`,
    amount: payload.amount,
    currency: payload.currency || 'SAR',
    status: 'initiated',
    metadata: payload.metadata || {},
  };
};
const { createApp } = require('../src/app');
const User = require('../src/models/User');
const Subscription = require('../src/models/Subscription');
const SubscriptionDay = require('../src/models/SubscriptionDay');
const BuilderProtein = require('../src/models/BuilderProtein');
const BuilderCategory = require('../src/models/BuilderCategory');
const Plan = require('../src/models/Plan');
const CheckoutDraft = require('../src/models/CheckoutDraft');
const Zone = require('../src/models/Zone');
const Setting = require('../src/models/Setting');
const Addon = require('../src/models/Addon');
const MenuCategory = require('../src/models/MenuCategory');
const MenuProduct = require('../src/models/MenuProduct');
const PremiumUpgradeConfig = require('../src/models/PremiumUpgradeConfig');
const { ensureSafeForDestructiveOp } = require('../src/utils/dbSafety');
const { VAT_PERCENTAGE } = require('../src/config/vat');
const dateUtils = require('../src/utils/date');
const { getRestaurantBusinessDate } = require('../src/services/restaurantHoursService');

const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';
const PORT = process.env.PORT || 3000;
const BASE_URL = `http://localhost:${PORT}`;

function issueAppAccessToken(userId) {
  return jwt.sign(
    { userId: String(userId), role: 'client', tokenType: 'app_access' },
    JWT_SECRET,
    { expiresIn: '31d' }
  );
}

const isTestEnv = process.env.NODE_ENV === 'test';

let server = null;
let mongoReplSet = null;
let app = null;
let testUser = null;
let authToken = null;
let builderCategory = null;

let canonicalShrimp = null;
let canonicalBeefSteak = null;
let legacyShrimp = null;
let legacyBeefSteak = null;
let testPlan = null;
let testZone = null;
let addonPlanJuice = null;
let addonPlanSnack = null;
let addonItemJuice = null;
let premiumLargeSaladProduct = null;

const TEST_USER_PHONE = '+966501234999';
const TEST_USER_PASSWORD = 'testpassword123';
const TEST_DELIVERY_WINDOW = '09:00 - 12:00';
const TEST_DELIVERY_SLOT_ID = 'delivery_slot_1';

function assertEqual(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg || 'Assertion failed'}: expected ${expected}, got ${actual}`);
}

function assertTrue(actual, msg) {
  if (actual !== true) throw new Error(`${msg || 'Assertion failed'}: expected true, got ${actual}`);
}

function assertNoTopLevelOk(body, msg) {
  if (Object.prototype.hasOwnProperty.call(body || {}, 'ok')) {
    throw new Error(`${msg || 'Assertion failed'}: top-level ok must be absent`);
  }
}

function assertNotNull(actual, msg) {
  if (actual === null || actual === undefined) throw new Error(`${msg || 'Assertion failed'}: expected non-null value`);
}

function expectedInclusiveVatHalala(totalHalala) {
  return Math.round((Number(totalHalala || 0) * VAT_PERCENTAGE) / (100 + VAT_PERCENTAGE));
}

function assertInclusiveVatBreakdown(breakdown, msg) {
  const totalHalala = Number(breakdown?.totalHalala || 0);
  const vatHalala = Number(breakdown?.vatHalala || 0);
  const subtotalHalala = Number(breakdown?.subtotalHalala || breakdown?.subtotalBeforeVatHalala || 0);
  assertEqual(Number(breakdown?.vatPercentage), VAT_PERCENTAGE, `${msg} VAT percentage`);
  assertEqual(vatHalala, expectedInclusiveVatHalala(totalHalala), `${msg} inclusive VAT extraction`);
  assertEqual(subtotalHalala + vatHalala, totalHalala, `${msg} customerPays equals displayed total`);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildDateOffset(daysOffset) {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  return d.toISOString().split('T')[0];
}

async function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: { 'Content-Type': 'application/json', 'Accept-Language': 'en' },
    };
    if (authToken) options.headers['Authorization'] = `Bearer ${authToken}`;
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data), headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, body: data, headers: res.headers });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function createTestUserAndAuthenticate() {
  let user = await User.findOne({ phone: TEST_USER_PHONE });
  if (!user) {
    const bcrypt = require('bcryptjs');
    const hashedPassword = await bcrypt.hash(TEST_USER_PASSWORD, 10);
    user = new User({
      phone: TEST_USER_PHONE,
      name: 'Checkout Test User',
      password: hashedPassword,
      role: 'client',
      isActive: true,
    });
    await user.save();
  } else {
    user.name = user.name || 'Checkout Test User';
    user.role = 'client';
    user.isActive = true;
    await user.save();
  }
  testUser = user;
  authToken = issueAppAccessToken(user._id);
}

async function seedBuilderCatalog() {
  builderCategory = await BuilderCategory.findOne({ dimension: 'protein' });
  if (!builderCategory) {
    builderCategory = new BuilderCategory({
      key: 'protein_category', dimension: 'protein',
      name: { ar: 'بروتين', en: 'Protein' },
      description: { ar: 'مصادر البروتين', en: 'Protein sources' },
      isActive: true, sortOrder: 1,
    });
    await builderCategory.save();
  }
  
  const baseProtein = { 
    displayCategoryId: builderCategory._id, 
    displayCategoryKey: builderCategory.key, 
    isActive: true, 
    availableForSubscription: true 
  };
  
  canonicalShrimp = await BuilderProtein.findOne({ premiumKey: 'shrimp', isPremium: true });
  if (!canonicalShrimp) {
    canonicalShrimp = new BuilderProtein({
      ...baseProtein,
      name: { ar: 'جمبري', en: 'Shrimp' },
      description: { ar: 'جمبري مشوي', en: 'Grilled shrimp' },
      proteinFamilyKey: 'seafood',
      ruleTags: ['premium'],
      isPremium: true,
      premiumKey: 'shrimp',
      extraFeeHalala: 1500,
      currency: 'SAR',
    });
    await canonicalShrimp.save();
  }
  
  canonicalBeefSteak = await BuilderProtein.findOne({ premiumKey: 'beef_steak', isPremium: true });
  if (!canonicalBeefSteak) {
    canonicalBeefSteak = new BuilderProtein({
      ...baseProtein,
      name: { ar: 'ستيك لحم', en: 'Beef Steak' },
      description: { ar: 'ستيك لحم مشوي', en: 'Grilled beef steak' },
      proteinFamilyKey: 'beef',
      ruleTags: ['premium'],
      isPremium: true,
      premiumKey: 'beef_steak',
      extraFeeHalala: 2000,
      currency: 'SAR',
    });
    await canonicalBeefSteak.save();
  }

  const premiumCategory = await MenuCategory.findOneAndUpdate(
    { key: 'checkout_test_premium' },
    {
      $set: {
        key: 'checkout_test_premium',
        name: { ar: 'اختبار بريميوم', en: 'Checkout Premium' },
        isActive: true,
        isVisible: true,
        isAvailable: true,
        publishedAt: new Date(),
      },
    },
    { upsert: true, new: true }
  );

  premiumLargeSaladProduct = await MenuProduct.findOneAndUpdate(
    { key: 'premium_large_salad' },
    {
      $set: {
        categoryId: premiumCategory._id,
        key: 'premium_large_salad',
        name: { ar: 'سلطة كبيرة مميزة', en: 'Premium Large Salad' },
        description: { ar: 'سلطة مميزة للاختبار', en: 'Premium salad test product' },
        itemType: 'premium_large_salad',
        pricingModel: 'fixed',
        priceHalala: 2900,
        currency: 'SAR',
        availableFor: ['subscription'],
        isCustomizable: true,
        isActive: true,
        isVisible: true,
        isAvailable: true,
        publishedAt: new Date(),
      },
    },
    { upsert: true, new: true }
  );

  await PremiumUpgradeConfig.findOneAndUpdate(
    { premiumKey: 'premium_large_salad' },
    {
      $set: {
        sourceType: 'menu_product',
        sourceId: premiumLargeSaladProduct._id,
        sourceProductId: premiumLargeSaladProduct._id,
        sourceGroupId: null,
        selectionType: 'premium_large_salad',
        premiumKey: 'premium_large_salad',
        displayGroupKey: 'premium',
        upgradeDeltaHalala: 2900,
        currency: 'SAR',
        isEnabled: true,
        isVisible: true,
        status: 'active',
        sourceSnapshot: {
          key: 'premium_large_salad',
          name: premiumLargeSaladProduct.name,
          context: { productKey: 'premium_large_salad' },
        },
      },
    },
    { upsert: true, new: true }
  );
  
  testZone = await Zone.findOne({ name: { $regex: /test/i } });
  if (!testZone) {
    testZone = new Zone({
      name: { ar: 'منطقة اختبار', en: 'Test Zone' },
      deliveryFeeHalala: 1500,
      isActive: true,
    });
    await testZone.save();
  }
  
  let pickupLocationsSetting = await Setting.findOne({ key: 'pickup_locations' });
  if (!pickupLocationsSetting) {
    pickupLocationsSetting = new Setting({
      key: 'pickup_locations',
      value: [
        {
          id: 'test_pickup_location',
          name: { ar: 'نقطة اختبار', en: 'Test Pickup' },
          address: { street: 'Test St', city: 'Riyadh' },
        },
      ],
    });
    await pickupLocationsSetting.save();
  }

  await Setting.findOneAndUpdate(
    { key: 'delivery_windows' },
    { $set: { key: 'delivery_windows', value: [TEST_DELIVERY_WINDOW, '12:00 - 15:00'] } },
    { upsert: true, new: true }
  );
  
  const premiumProteins = await BuilderProtein.find({ isPremium: true }).lean();
const proteinsWithoutKey = premiumProteins.filter(p => !p.premiumKey);

if (proteinsWithoutKey.length >= 2) {
  legacyShrimp = proteinsWithoutKey[0];
  legacyBeefSteak = proteinsWithoutKey[1];
} else if (proteinsWithoutKey.length === 1) {
  legacyShrimp = proteinsWithoutKey[0];
  legacyBeefSteak = await BuilderProtein.findOne({
    isPremium: true,
    name: { $ne: legacyShrimp.name },
  });
} else {
  legacyShrimp = premiumProteins[0];
  legacyBeefSteak = premiumProteins[1] || premiumProteins[0];
}
  
  testPlan = await Plan.findOne({ name: { $regex: /basic/i } });
  if (!testPlan) {
    testPlan = new Plan({
      name: { ar: 'بسيك', en: 'Basic' },
      description: { ar: 'خطة أساسية', en: 'Basic plan' },
      gramsOptions: [
        {
          grams: 300,
          mealsOptions: [
            { mealsPerDay: 2, priceHalala: 49000, compareAtHalala: 49000 },
          ],
        },
      ],
      daysCount: 28,
      currency: 'SAR',
      isActive: true,
      sortOrder: 1,
    });
    await testPlan.save();
  }

  addonPlanJuice = await Addon.findOne({ kind: 'plan', category: 'juice', billingMode: 'per_day' });
  if (!addonPlanJuice) {
    addonPlanJuice = new Addon({
      name: { ar: 'اشتراك العصير', en: 'Juice Subscription' },
      description: { ar: 'اشتراك يومي للعصير', en: 'Daily juice subscription' },
      kind: 'plan',
      category: 'juice',
      billingMode: 'per_day',
      priceHalala: 1100,
      currency: 'SAR',
      isActive: true,
      sortOrder: 1,
    });
    await addonPlanJuice.save();
  } else {
    addonPlanJuice.isActive = true;
    addonPlanJuice.isArchived = false;
    addonPlanJuice.priceHalala = 1100;
    await addonPlanJuice.save();
  }

  addonPlanSnack = await Addon.findOne({ kind: 'plan', category: 'snack', billingMode: 'per_day' });
  if (!addonPlanSnack) {
    addonPlanSnack = new Addon({
      name: { ar: 'اشتراك السناك', en: 'Snack Subscription' },
      description: { ar: 'اشتراك يومي للسناك', en: 'Daily snack subscription' },
      kind: 'plan',
      category: 'snack',
      billingMode: 'per_day',
      priceHalala: 500,
      currency: 'SAR',
      isActive: true,
      sortOrder: 3,
    });
    await addonPlanSnack.save();
  } else {
    addonPlanSnack.isActive = true;
    addonPlanSnack.isArchived = false;
    addonPlanSnack.priceHalala = 500;
    await addonPlanSnack.save();
  }

  addonItemJuice = await Addon.findOne({ kind: 'item', category: 'juice', billingMode: 'flat_once' });
  if (!addonItemJuice) {
    addonItemJuice = new Addon({
      name: { ar: 'بيري بلاست', en: 'Berry Blast' },
      description: { ar: 'عنصر عصير', en: 'Juice item' },
      kind: 'item',
      category: 'juice',
      billingMode: 'flat_once',
      priceHalala: 1100,
      currency: 'SAR',
      isActive: true,
      sortOrder: 2,
    });
    await addonItemJuice.save();
  } else {
    addonItemJuice.isActive = true;
    addonItemJuice.isArchived = false;
    addonItemJuice.priceHalala = 1100;
    await addonItemJuice.save();
  }

  const AddonPlanPrice = require('../src/models/AddonPlanPrice');
  await AddonPlanPrice.findOneAndUpdate(
    { addonPlanId: addonPlanJuice._id, basePlanId: testPlan._id },
    { $set: { priceHalala: 1100, isActive: true } },
    { upsert: true }
  );
  await AddonPlanPrice.findOneAndUpdate(
    { addonPlanId: addonPlanSnack._id, basePlanId: testPlan._id },
    { $set: { priceHalala: 500, isActive: true } },
    { upsert: true }
  );
}

async function cleanupTestData() {
  await CheckoutDraft.deleteMany({ userId: testUser._id });
  const subs = await Subscription.find({ userId: testUser._id }).lean();
  for (const sub of subs) {
    await SubscriptionDay.deleteMany({ subscriptionId: sub._id });
  }
  await Subscription.deleteMany({ userId: testUser._id });
  await User.deleteOne({ _id: testUser._id });
  testUser = null;
  authToken = null;
}

async function startServer() {
  return new Promise((resolve, reject) => {
    app = createApp();
    server = http.createServer(app);
    server.listen(PORT, () => { resolve(); });
    server.on('error', reject);
  });
}

async function stopServer() {
  if (server) {
    return new Promise(resolve => { server.close(() => resolve()); });
  }
}

const { resolveMongoUri, getDbNameFromUri } = require("../src/utils/mongoUriResolver");

async function connectDatabase() {
  const useMemoryReplSet = String(process.env.USE_MONGODB_MEMORY_REPLSET || '').toLowerCase() === 'true';
  const mongoUri = useMemoryReplSet
    ? await (async () => {
      mongoReplSet = await MongoMemoryReplSet.create({ replSet: { storageEngine: 'wiredTiger' } });
      return mongoReplSet.getUri(`checkout_integration_test_${Date.now()}`);
    })()
    : resolveMongoUri();
  const dbName = getDbNameFromUri(mongoUri);

  console.log(`Connecting to database: ${dbName}...`);

  if (mongoose.connection.readyState === 1) return;
  if (mongoose.connection.readyState === 2) { await mongoose.connection.asPromise(); return; }
  
  try {
    await mongoose.connect(mongoUri);
  } catch (err) {
    console.error(`\n❌ MongoDB connection failed for ${dbName}!`);
    const maskedUri = mongoUri.replace(/:([^@]+)@/, ':****@');
    console.error(`URI tried: ${maskedUri}`);
    console.error(`Error: ${err.message}\n`);
    throw new Error('SKIP');
  }
}

async function disconnectDatabase() {
  await mongoose.disconnect();
  if (mongoReplSet) {
    await mongoReplSet.stop();
    mongoReplSet = null;
  }
}

async function runTests() {
  const results = { passed: 0, failed: 0, skipped: 0 };
  
  const test = async (name, fn) => {
    try {
      await fn();
      console.log(`✅ ${name}`);
      results.passed++;
    } catch (err) {
      if (err.message === 'SKIP') {
        console.log(`⏭️ ${name}: skipped`);
        results.skipped++;
      } else {
        console.log(`❌ ${name}: ${err.message}`);
        results.failed++;
      }
    }
  };
  
  console.log('\n==========================================');
  console.log('CHECKOUT INTEGRATION TESTS');
  console.log('==========================================\n');
  
  console.log('--- Setup ---\n');
  
  await createTestUserAndAuthenticate();
  console.log('✅ Test user created');
  await seedBuilderCatalog();
  console.log('✅ Builder catalog seeded');
  console.log(`  Legacy Shrimp ID: ${legacyShrimp._id}`);
  console.log(`  Legacy Beef Steak ID: ${legacyBeefSteak._id}`);
  console.log(`  Canonical Shrimp ID: ${canonicalShrimp._id}`);
  console.log(`  Canonical Beef Steak ID: ${canonicalBeefSteak._id}`);
  console.log(`  Delivery Zone ID: ${testZone._id}`);
  
  const startDate = buildDateOffset(1);
  const sameDayStartDate = await getRestaurantBusinessDate();
  const buildBaseSubscriptionPayload = () => ({
    planId: String(testPlan._id),
    grams: 300,
    mealsPerDay: 2,
    startDate,
    delivery: {
      type: 'delivery',
      address: { street: 'Test Street', city: 'Riyadh' },
      zoneId: String(testZone._id),
      slot: { slotId: TEST_DELIVERY_SLOT_ID },
    },
  });

  console.log('\n--- A0) Add-on Catalog Separation ---\n');

  await test('GET /api/subscriptions/menu exposes only plan add-ons for checkout', async () => {
    const res = await makeRequest('GET', '/api/subscriptions/menu');
    assertEqual(res.status, 200, 'menu status');
    assertEqual(res.body.status, true, 'status');
    const addons = res.body.data?.addons || [];
    assertTrue(addons.length > 0, 'checkout addons returned');
    assertTrue(addons.every((addon) => addon.kind === 'plan'), 'checkout menu excludes item addons');
    assertTrue(addons.some((addon) => addon.id === String(addonPlanJuice._id)), 'juice plan included');
    assertTrue(!addons.some((addon) => addon.id === String(addonItemJuice._id)), 'juice item excluded');
  });

  await test('GET /api/subscriptions/menu nests only item add-ons under mealPlanner.addons', async () => {
    const res = await makeRequest('GET', '/api/subscriptions/menu');
    assertEqual(res.status, 200, 'menu status');
    const plannerAddons = res.body.data?.mealPlanner?.addons?.items || [];
    assertTrue(plannerAddons.length > 0, 'planner addons returned');
    assertTrue(plannerAddons.every((addon) => addon.kind === 'item'), 'nested planner addons exclude plans');
    assertTrue(plannerAddons.some((addon) => addon.id === String(addonItemJuice._id)), 'planner item included');
    assertTrue(!plannerAddons.some((addon) => addon.id === String(addonPlanJuice._id)), 'planner plan excluded');
  });

  await test('POST /api/subscriptions/quote prices per_day add-on plans by subscription duration', async () => {
    const quotePayload = {
      planId: String(testPlan._id),
      grams: 300,
      mealsPerDay: 2,
      startDate,
      delivery: {
        type: 'delivery',
        address: { street: 'Test Street', city: 'Riyadh' },
        zoneId: String(testZone._id),
        slot: { slotId: TEST_DELIVERY_SLOT_ID },
      },
      addons: [String(addonPlanJuice._id)],
    };

    const res = await makeRequest('POST', '/api/subscriptions/quote', quotePayload);
    assertEqual(res.status, 200, 'quote status');
    assertEqual(res.body.status, true, 'status');
    const expectedAddonsTotal = Number(addonPlanJuice.priceHalala || 0);
    assertEqual(Number(res.body.data?.breakdown?.addonsTotalHalala || 0), expectedAddonsTotal, 'plan add-on total uses flat pricing');
    assertInclusiveVatBreakdown(res.body.data?.breakdown, 'subscription quote with add-on');
    const summaryAddon = res.body.data?.summary?.addons?.[0];
    assertNotNull(summaryAddon, 'summary addon exists');
    assertEqual(summaryAddon.qty, 1, 'summary addon qty reflects selected addon');
    assertEqual(summaryAddon.durationDays, Number(testPlan.daysCount || 0), 'summary addon duration reflects plan days');
    assertEqual(summaryAddon.unitPriceSar, Number(addonPlanJuice.priceHalala || 0) / 100, 'summary addon unit price reflects catalog price');
    assertEqual(summaryAddon.totalSar, expectedAddonsTotal / 100, 'summary addon total uses flat price');
    assertEqual(summaryAddon.totalLabel, `${expectedAddonsTotal / 100} SAR`, 'summary addon total label matches total');
  });

  await test('POST /api/subscriptions/quote sums multiple selected add-ons in summary and line items', async () => {
    const quotePayload = {
      planId: String(testPlan._id),
      grams: 300,
      mealsPerDay: 2,
      startDate,
      delivery: {
        type: 'delivery',
        address: { street: 'Test Street', city: 'Riyadh' },
        zoneId: String(testZone._id),
        slot: { slotId: TEST_DELIVERY_SLOT_ID },
      },
      addons: [String(addonPlanJuice._id), String(addonPlanSnack._id)],
    };

    const res = await makeRequest('POST', '/api/subscriptions/quote', quotePayload);
    assertEqual(res.status, 200, 'quote status');
    assertEqual(res.body.status, true, 'status');

    const summaryAddons = res.body.data?.summary?.addons || [];
    assertEqual(summaryAddons.length, 2, 'summary contains one row per selected addon');
    const summaryTotalSar = summaryAddons.reduce((sum, addon) => sum + Number(addon.totalSar || 0), 0);
    const lineItemAddons = (res.body.data?.summary?.lineItems || []).find((item) => item.kind === 'addons');
    assertNotNull(lineItemAddons, 'addons line item exists');
    assertEqual(summaryTotalSar, lineItemAddons.amountSar, 'summary addon totals equal addons line item');
    assertEqual(Number(res.body.data?.breakdown?.addonsTotalHalala || 0), summaryTotalSar * 100, 'breakdown addons total equals summary addon total');
  });

  await test('POST /api/subscriptions/quote returns empty addon summary and zero addon total when no add-ons are selected', async () => {
    const res = await makeRequest('POST', '/api/subscriptions/quote', buildBaseSubscriptionPayload());
    assertEqual(res.status, 200, 'quote status');
    assertEqual(res.body.status, true, 'status');
    assertEqual((res.body.data?.summary?.addons || []).length, 0, 'summary addons is empty');
    assertEqual(Number(res.body.data?.breakdown?.addonsTotalHalala || 0), 0, 'addons total is zero');
  });

  await test('POST /api/subscriptions/quote with valid delivery slot returns summary delivery slot label/window', async () => {
    const res = await makeRequest('POST', '/api/subscriptions/quote', buildBaseSubscriptionPayload());
    assertEqual(res.status, 200, 'delivery slot quote status');
    assertEqual(res.body.status, true, 'delivery slot quote status field');
    const slot = res.body.data?.summary?.delivery?.slot;
    assertNotNull(slot, 'summary delivery slot exists');
    assertEqual(slot.slotId, TEST_DELIVERY_SLOT_ID, 'summary delivery slotId preserved');
    assertEqual(slot.window, TEST_DELIVERY_WINDOW, 'summary delivery window resolved from slotId');
    assertTrue(Boolean(slot.label), 'summary delivery slot label returned');
  });

  await test('POST /api/subscriptions/checkout with valid delivery slot stores slot/window in draft', async () => {
    const idempotencyKey = `checkout_test_delivery_slot_${Date.now()}`;
    const res = await makeRequest('POST', '/api/subscriptions/checkout', {
      ...buildBaseSubscriptionPayload(),
      idempotencyKey,
    });

    assertEqual(res.status, 201, 'delivery slot checkout status');
    assertEqual(res.body.status, true, 'delivery slot checkout status field');
    const draft = await CheckoutDraft.findById(res.body.data?.draftId).lean();
    assertTrue(!!draft, 'delivery slot draft exists');
    assertEqual(draft.delivery?.slot?.slotId, TEST_DELIVERY_SLOT_ID, 'draft delivery slotId stored');
    assertEqual(draft.delivery?.slot?.window, TEST_DELIVERY_WINDOW, 'draft delivery window stored');
    assertTrue(Boolean(draft.delivery?.slot?.label), 'draft delivery slot label stored');
    assertEqual(draft.contractSnapshot?.delivery?.slot?.slotId, TEST_DELIVERY_SLOT_ID, 'contract delivery slotId stored');
    assertEqual(draft.contractSnapshot?.delivery?.slot?.window, TEST_DELIVERY_WINDOW, 'contract delivery window stored');
  });

  await test('same-day home delivery activates first day as pickup override and keeps later days as delivery', async () => {
    const idempotencyKey = `checkout_test_delivery_status_${Date.now()}`;
    const checkoutRes = await makeRequest('POST', '/api/subscriptions/checkout', {
      ...buildBaseSubscriptionPayload(),
      startDate: sameDayStartDate,
      delivery: {
        ...buildBaseSubscriptionPayload().delivery,
        address: {
          street: 'Fulfillment Street',
          building: '12',
          apartment: '5',
          district: 'Test District',
          city: 'Riyadh',
        },
      },
      idempotencyKey,
    });
    assertEqual(checkoutRes.status, 201, 'delivery status checkout status');
    const draft = await CheckoutDraft.findById(checkoutRes.body.data?.draftId).lean();
    assertTrue(!!draft, 'delivery status draft exists');

    const Payment = require('../src/models/Payment');
    const payment = new Payment({
      userId: testUser._id,
      draftId: draft._id,
      type: 'subscription_activation',
      amount: draft.breakdown.totalHalala,
      currency: 'SAR',
      status: 'paid',
      provider: 'moyasar',
      providerInvoiceId: `test_delivery_slot_invoice_${Date.now()}`,
      invoiceResponse: { id: `test_delivery_slot_invoice_${Date.now()}`, url: 'https://example.com/pay' },
    });
    await payment.save();

    const { finalizeSubscriptionDraftPaymentFlow } = require('../src/services/subscription/subscriptionActivationService');
    const result = await finalizeSubscriptionDraftPaymentFlow({ draft, payment }, null);
    assertTrue(result.applied, 'delivery status activation applied');

    const subscription = await Subscription.findById(result.subscriptionId).lean();
    assertEqual(subscription.deliverySlot?.slotId, TEST_DELIVERY_SLOT_ID, 'subscription delivery slotId retained');
    assertEqual(subscription.deliverySlot?.window, TEST_DELIVERY_WINDOW, 'subscription delivery window retained');
    assertEqual(subscription.deliveryWindow, TEST_DELIVERY_WINDOW, 'subscription deliveryWindow retained');

    const day1StatusRes = await makeRequest('GET', `/api/subscriptions/${result.subscriptionId}/days/${sameDayStartDate}/fulfillment/status`);
    assertEqual(day1StatusRes.status, 200, 'day 1 fulfillment status response');
    assertEqual(day1StatusRes.body.data?.deliveryMode, 'delivery', 'day 1 root delivery mode');
    assertEqual(day1StatusRes.body.data?.effectiveFulfillmentMode, 'pickup', 'day 1 uses pickup override');
    assertEqual(day1StatusRes.body.data?.fulfillmentModeOverride, 'pickup', 'day 1 pickup override returned');
    assertEqual(day1StatusRes.body.data?.firstDayFulfillmentOverride, true, 'day 1 first-day override flag');
    assertNotNull(day1StatusRes.body.data?.pickupLocation, 'day 1 pickup location returned');

    const secondDate = dateUtils.addDaysToKSADateString(sameDayStartDate, 1);
    const statusRes = await makeRequest('GET', `/api/subscriptions/${result.subscriptionId}/days/${secondDate}/fulfillment/status`);
    assertEqual(statusRes.status, 200, 'day 2 fulfillment status response');
    assertEqual(statusRes.body.data?.deliveryMode, 'delivery', 'day 2 delivery mode');
    assertEqual(statusRes.body.data?.effectiveFulfillmentMode, 'delivery', 'day 2 effective delivery mode');
    assertNotNull(statusRes.body.data?.deliveryAddress, 'day 2 fulfillment delivery address returned');
    assertNotNull(statusRes.body.data?.deliveryWindow, 'day 2 fulfillment delivery window returned');
    assertEqual(statusRes.body.data?.deliveryWindow?.window, TEST_DELIVERY_WINDOW, 'day 2 fulfillment delivery window value');
    assertEqual(statusRes.body.data?.deliverySlot?.slotId, TEST_DELIVERY_SLOT_ID, 'day 2 fulfillment delivery slotId');
    assertEqual(statusRes.body.data?.lockedReason, null, 'day 2 fulfillment is not locked for missing window');
  });

  await test('future home delivery starts as delivery without first-day pickup override', async () => {
    const idempotencyKey = `checkout_test_future_delivery_status_${Date.now()}`;
    const checkoutRes = await makeRequest('POST', '/api/subscriptions/checkout', {
      ...buildBaseSubscriptionPayload(),
      idempotencyKey,
    });
    assertEqual(checkoutRes.status, 201, 'future delivery checkout status');
    const draft = await CheckoutDraft.findById(checkoutRes.body.data?.draftId).lean();
    assertTrue(!!draft, 'future delivery draft exists');

    const Payment = require('../src/models/Payment');
    const payment = new Payment({
      userId: testUser._id,
      draftId: draft._id,
      type: 'subscription_activation',
      amount: draft.breakdown.totalHalala,
      currency: 'SAR',
      status: 'paid',
      provider: 'moyasar',
      providerInvoiceId: `test_future_delivery_invoice_${Date.now()}`,
      invoiceResponse: { id: `test_future_delivery_invoice_${Date.now()}`, url: 'https://example.com/pay' },
    });
    await payment.save();

    const { finalizeSubscriptionDraftPaymentFlow } = require('../src/services/subscription/subscriptionActivationService');
    const result = await finalizeSubscriptionDraftPaymentFlow({ draft, payment }, null);
    assertTrue(result.applied, 'future delivery activation applied');

    const day1StatusRes = await makeRequest('GET', `/api/subscriptions/${result.subscriptionId}/days/${startDate}/fulfillment/status`);
    assertEqual(day1StatusRes.status, 200, 'future day 1 fulfillment status response');
    assertEqual(day1StatusRes.body.data?.deliveryMode, 'delivery', 'future day 1 root delivery mode');
    assertEqual(day1StatusRes.body.data?.effectiveFulfillmentMode, 'delivery', 'future day 1 remains delivery');
    assertEqual(day1StatusRes.body.data?.fulfillmentModeOverride, null, 'future day 1 has no pickup override');
    assertEqual(day1StatusRes.body.data?.firstDayFulfillmentOverride, false, 'future day 1 first-day override flag false');
  });

  await test('POST /api/subscriptions/quote rejects invalid delivery slot with 422', async () => {
    const payload = buildBaseSubscriptionPayload();
    payload.delivery.slot = { slotId: 'delivery_slot_999' };
    const res = await makeRequest('POST', '/api/subscriptions/quote', payload);
    assertEqual(res.status, 422, 'invalid delivery slot quote status');
    assertEqual(res.body.error?.code, 'INVALID_DELIVERY_SLOT', 'invalid delivery slot code');
  });

  await test('POST /api/subscriptions/checkout rejects missing delivery slot with 422', async () => {
    const payload = {
      ...buildBaseSubscriptionPayload(),
      delivery: {
        type: 'delivery',
        address: { street: 'Test Street', city: 'Riyadh' },
        zoneId: String(testZone._id),
      },
      idempotencyKey: `checkout_test_missing_delivery_slot_${Date.now()}`,
    };
    const res = await makeRequest('POST', '/api/subscriptions/checkout', payload);
    assertEqual(res.status, 422, 'missing delivery slot checkout status');
    assertEqual(res.body.error?.code, 'DELIVERY_WINDOW_MISSING', 'missing delivery slot code');
  });

  await test('POST /api/subscriptions/quote rejects missing delivery slot with 422', async () => {
    const payload = {
      ...buildBaseSubscriptionPayload(),
      delivery: {
        type: 'delivery',
        address: { street: 'Test Street', city: 'Riyadh' },
        zoneId: String(testZone._id),
      },
    };
    const res = await makeRequest('POST', '/api/subscriptions/quote', payload);
    assertEqual(res.status, 422, 'missing delivery slot quote status');
    assertEqual(res.body.error?.code, 'DELIVERY_WINDOW_MISSING', 'missing delivery slot quote code');
  });

  await test('legacy subscription missing delivery window returns lockedReason and deliveryAddress', async () => {
    const legacyUser = await User.create({
      phone: `+9665099${Date.now()}`,
      name: 'Legacy Fulfillment Test User',
      role: 'client',
      isActive: true,
    });
    const previousToken = authToken;
    authToken = issueAppAccessToken(legacyUser._id);
    const legacySub = await Subscription.create({
      userId: legacyUser._id,
      planId: testPlan._id,
      status: 'active',
      startDate: new Date(`${startDate}T00:00:00.000Z`),
      endDate: new Date(`${startDate}T00:00:00.000Z`),
      validityEndDate: new Date(`${startDate}T00:00:00.000Z`),
      totalMeals: 2,
      remainingMeals: 2,
      selectedGrams: 300,
      selectedMealsPerDay: 2,
      deliveryMode: 'delivery',
      deliveryAddress: {
        street: 'Legacy Street',
        district: 'Legacy District',
        city: 'Riyadh',
      },
      deliveryZoneId: testZone._id,
      deliveryZoneName: 'Test Zone',
      deliverySlot: { type: 'delivery', slotId: TEST_DELIVERY_SLOT_ID, window: '' },
    });
    await SubscriptionDay.create({ subscriptionId: legacySub._id, date: startDate, status: 'open' });

    const res = await makeRequest('GET', `/api/subscriptions/${legacySub._id}/days/${startDate}/fulfillment/status`);
    assertEqual(res.status, 200, 'legacy missing window status response');
    assertNotNull(res.body.data?.deliveryAddress, 'legacy delivery address returned');
    assertEqual(res.body.data?.deliveryWindow, null, 'legacy delivery window remains null');
    assertEqual(res.body.data?.lockedReason, 'DELIVERY_WINDOW_MISSING', 'legacy missing delivery window locked reason');
    authToken = previousToken;
  });

  await test('POST /api/subscriptions/quote auto-selects sole pickup location when omitted', async () => {
    const quotePayload = {
      planId: String(testPlan._id),
      grams: 300,
      mealsPerDay: 2,
      startDate,
      delivery: {
        type: 'pickup',
      },
    };

    const res = await makeRequest('POST', '/api/subscriptions/quote', quotePayload);
    assertEqual(res.status, 200, 'pickup quote status');
    assertEqual(res.body.status, true, 'pickup quote status field');
    assertEqual(Number(res.body.data?.breakdown?.deliveryFeeHalala || 0), 0, 'pickup delivery fee is zero');
  });

  await test('POST /api/subscriptions/quote rejects direct purchase of item add-ons', async () => {
    const quotePayload = {
      planId: String(testPlan._id),
      grams: 300,
      mealsPerDay: 2,
      startDate,
      delivery: {
        type: 'delivery',
        address: { street: 'Test Street', city: 'Riyadh' },
        zoneId: String(testZone._id),
        slot: { slotId: TEST_DELIVERY_SLOT_ID },
      },
      addons: [String(addonItemJuice._id)],
    };

    const res = await makeRequest('POST', '/api/subscriptions/quote', quotePayload);
    assertEqual(res.status, 400, 'quote rejected');
    assertEqual(res.body.error?.code, 'INVALID', 'item add-on purchase rejected');
  });

  await test('POST /api/subscriptions/quote accepts premium_large_salad premium item', async () => {
    const quotePayload = {
      ...buildBaseSubscriptionPayload(),
      premiumItems: [
        { premiumKey: 'premium_large_salad', qty: 1 },
      ],
    };

    const res = await makeRequest('POST', '/api/subscriptions/quote', quotePayload);
    assertEqual(res.status, 200, 'large salad quote status');
    assertEqual(res.body.status, true, 'large salad quote status field');
    assertTrue(Number(res.body.data?.breakdown?.premiumTotalHalala || 0) > 0, 'large salad premium total is priced');
    const item = (res.body.data?.summary?.premiumItems || []).find(p => p.premiumKey === 'premium_large_salad');
    assertNotNull(item, 'large salad appears in quote premium summary');
    assertEqual(item.qty, 1, 'large salad quote qty preserved');
  });

  await test('POST /api/subscriptions/quote normalizes custom_premium_salad premium item alias', async () => {
    const quotePayload = {
      ...buildBaseSubscriptionPayload(),
      premiumItems: [
        { premiumKey: 'custom_premium_salad', qty: 1 },
      ],
    };

    const res = await makeRequest('POST', '/api/subscriptions/quote', quotePayload);
    assertEqual(res.status, 200, 'legacy salad alias quote status');
    assertEqual(res.body.status, true, 'legacy salad alias quote status field');
    const item = (res.body.data?.summary?.premiumItems || []).find(p => p.premiumKey === 'premium_large_salad');
    assertNotNull(item, 'legacy salad alias normalized in quote summary');
    assertEqual(item.qty, 1, 'legacy salad alias quote qty preserved');
  });

  await test('POST /api/subscriptions/checkout purchases plan add-ons into draft entitlements', async () => {
    const idempotencyKey = `checkout_test_addon_plan_${Date.now()}`;
    const checkoutPayload = {
      planId: String(testPlan._id),
      grams: 300,
      mealsPerDay: 2,
      startDate,
      delivery: {
        type: 'delivery',
        address: { street: 'Test Street', city: 'Riyadh' },
        zoneId: String(testZone._id),
        slot: { slotId: TEST_DELIVERY_SLOT_ID },
      },
      addons: [String(addonPlanJuice._id)],
      idempotencyKey,
    };

    const res = await makeRequest('POST', '/api/subscriptions/checkout', checkoutPayload);
    assertEqual(res.status, 201, 'checkout status');
    assertEqual(res.body.status, true, 'status');
    const draft = await CheckoutDraft.findById(res.body.data?.draftId).lean();
    assertTrue(!!draft, 'draft exists');
    assertInclusiveVatBreakdown(draft.breakdown, 'subscription checkout draft with add-on');
    assertEqual(Number(res.body.data?.amountHalala || res.body.data?.totalHalala || draft.breakdown.totalHalala), Number(draft.breakdown.totalHalala), 'subscription checkout customer pays displayed total');
    assertTrue(Array.isArray(draft.addonSubscriptions), 'addonSubscriptions array exists');
    assertEqual(draft.addonSubscriptions.length, 1, 'one addon entitlement created');
    assertEqual(draft.addonSubscriptions[0].category, 'juice', 'entitlement category preserved');
    assertEqual(String(draft.addonSubscriptions[0].addonId), String(addonPlanJuice._id), 'plan addon id persisted');
  });

  console.log('\n--- A) Checkout with Legacy Premium IDs ---\n');
  
  await test('POST /api/subscriptions/checkout with legacy shrimp ID creates draft', async () => {
    const idempotencyKey = `checkout_test_legacy_${Date.now()}`;
    const checkoutPayload = {
      planId: String(testPlan._id),
      grams: 300,
      mealsPerDay: 2,
      startDate,
      delivery: {
        type: 'delivery',
        address: { street: 'Test Street', city: 'Riyadh' },
        zoneId: String(testZone._id),
        slot: { slotId: TEST_DELIVERY_SLOT_ID },
      },
      premiumItems: [
        { proteinId: String(legacyShrimp._id), qty: 2 },
        { proteinId: String(legacyBeefSteak._id), qty: 1 },
      ],
      idempotencyKey,
    };
    
    const res = await makeRequest('POST', '/api/subscriptions/checkout', checkoutPayload);
    if (res.status !== 201) {
      console.log('DEBUG: Checkout failed with status', res.status);
      console.log('DEBUG: Response body:', JSON.stringify(res.body, null, 2));
    }
    assertEqual(res.status, 201, 'checkout status');
    assertEqual(res.body.status, true, 'status');
    assertNoTopLevelOk(res.body, 'checkout response');
    assertTrue(!!res.body.data?.draftId, 'draftId present');
  });
  
  await test('CheckoutDraft.premiumItems contains premiumKey', async () => {
    const draft = await CheckoutDraft.findOne({ userId: testUser._id, status: 'pending_payment' })
      .sort({ createdAt: -1 })
      .lean();
    
    assertTrue(!!draft, 'draft exists');
    assertTrue(Array.isArray(draft.premiumItems), 'premiumItems is array');
    assertTrue(draft.premiumItems.length > 0, 'premiumItems not empty');
    
    const shrimpItem = draft.premiumItems.find(p => 
      String(p.proteinId) === String(canonicalShrimp._id) || 
      String(p.originalProteinId) === String(legacyShrimp._id)
    );
    assertNotNull(shrimpItem, 'shrimp item found');
    assertEqual(shrimpItem.premiumKey, 'shrimp', 'shrimp premiumKey');
    assertEqual(shrimpItem.qty, 2, 'shrimp qty');
  });
  
  await test('CheckoutDraft has premiumKey in premiumItems or contractSnapshot', async () => {
    const draft = await CheckoutDraft.findOne({ userId: testUser._id, status: 'pending_payment' })
      .sort({ createdAt: -1 })
      .lean();
    
    assertTrue(!!draft, 'draft exists');
    assertTrue(draft.premiumItems?.length > 0, 'premiumItems exists');
    
    const hasShrimp = draft.premiumItems.some(p => p.premiumKey === 'shrimp');
    const hasContractPremiumKey = draft.contractSnapshot?.premiumSelections?.some(p => p.premiumKey === 'shrimp');
    assertTrue(hasShrimp || hasContractPremiumKey, 'premiumKey present in draft');
  });
  
  console.log('\n--- B) Activate Subscription ---\n');
  
  await test('Simulate payment completion and activation', async () => {
    const draft = await CheckoutDraft.findOne({ userId: testUser._id, status: 'pending_payment' })
      .sort({ createdAt: -1 })
      .lean();
    
    assertTrue(!!draft, 'draft exists');
    
    const Payment = require('../src/models/Payment');
    await Payment.deleteMany({ userId: testUser._id });
    
    const uniqueInvoiceId = `test_invoice_${Date.now()}`;
    const payment = new Payment({
      userId: testUser._id,
      draftId: draft._id,
      type: 'subscription_activation',
      amount: draft.breakdown.totalHalala,
      currency: 'SAR',
      status: 'paid',
      provider: 'moyasar',
      providerInvoiceId: uniqueInvoiceId,
      invoiceResponse: { id: uniqueInvoiceId, url: 'https://example.com/pay' },
    });
    await payment.save();
    
    const { finalizeSubscriptionDraftPaymentFlow } = require('../src/services/subscription/subscriptionActivationService');
    const result = await finalizeSubscriptionDraftPaymentFlow({ draft, payment }, null);
    
    assertTrue(result.applied, 'activation applied');
    assertTrue(!!result.subscriptionId, 'subscriptionId returned');
  });
  
  await test('Subscription.premiumBalance has premiumKey set', async () => {
    const subscription = await Subscription.findOne({ userId: testUser._id, status: 'active' })
      .sort({ createdAt: -1 })
      .lean();
    
    assertTrue(!!subscription, 'subscription exists');
    assertTrue(Array.isArray(subscription.premiumBalance), 'premiumBalance is array');
    
    const shrimpBalance = subscription.premiumBalance.find(p => p.premiumKey === 'shrimp');
    assertNotNull(shrimpBalance, 'shrimp balance found');
    assertEqual(shrimpBalance.premiumKey, 'shrimp', 'shrimp premiumKey');
    assertEqual(shrimpBalance.purchasedQty, 2, 'shrimp purchasedQty');
    assertEqual(shrimpBalance.remainingQty, 2, 'shrimp remainingQty');
    
    const beefBalance = subscription.premiumBalance.find(p => p.premiumKey === 'beef_steak');
    assertNotNull(beefBalance, 'beef_steak balance found');
    assertEqual(beefBalance.premiumKey, 'beef_steak', 'beef_steak premiumKey');
    assertEqual(beefBalance.purchasedQty, 1, 'beef_steak purchasedQty');
    assertEqual(beefBalance.remainingQty, 1, 'beef_steak remainingQty');
  });
  
  await test('Subscription.premiumBalance uses canonical proteinId', async () => {
    const subscription = await Subscription.findOne({ userId: testUser._id, status: 'active' })
      .sort({ createdAt: -1 })
      .lean();
    
    const shrimpBalance = subscription.premiumBalance.find(p => p.premiumKey === 'shrimp');
    assertEqual(String(shrimpBalance.proteinId), String(canonicalShrimp._id), 'shrimp canonical proteinId');
    
    const beefBalance = subscription.premiumBalance.find(p => p.premiumKey === 'beef_steak');
    assertEqual(String(beefBalance.proteinId), String(canonicalBeefSteak._id), 'beef_steak canonical proteinId');
  });
  
  console.log('\n--- C) Current Overview ---\n');
  
  await test('GET /api/subscriptions/current/overview returns premiumSummary', async () => {
    const res = await makeRequest('GET', '/api/subscriptions/current/overview');
    assertEqual(res.status, 200, 'overview status');
    assertEqual(res.body.status, true, 'status');
    assertNoTopLevelOk(res.body, 'overview response');
    assertTrue(Array.isArray(res.body.data?.premiumSummary), 'premiumSummary is array');
  });
  
  await test('premiumSummary shrimp has correct totals', async () => {
    const res = await makeRequest('GET', '/api/subscriptions/current/overview');
    const summary = res.body.data?.premiumSummary || [];
    const shrimp = summary.find(p => p.premiumKey === 'shrimp');
    
    assertNotNull(shrimp, 'shrimp in summary');
    assertEqual(shrimp.purchasedQtyTotal, 2, 'shrimp purchasedQtyTotal');
    assertEqual(shrimp.remainingQtyTotal, 2, 'shrimp remainingQtyTotal');
  });
  
  await test('premiumSummary beef_steak has correct totals', async () => {
    const res = await makeRequest('GET', '/api/subscriptions/current/overview');
    const summary = res.body.data?.premiumSummary || [];
    const beefSteak = summary.find(p => p.premiumKey === 'beef_steak');
    
    assertNotNull(beefSteak, 'beef_steak in summary');
    assertEqual(beefSteak.purchasedQtyTotal, 1, 'beef_steak purchasedQtyTotal');
    assertEqual(beefSteak.remainingQtyTotal, 1, 'beef_steak remainingQtyTotal');
  });
  
  await test('premiumSummary has no premiumKey null rows', async () => {
    const res = await makeRequest('GET', '/api/subscriptions/current/overview');
    const summary = res.body.data?.premiumSummary || [];
    const nullKeys = summary.filter(p => !p.premiumKey || p.premiumKey === null || p.premiumKey === '');
    assertEqual(nullKeys.length, 0, 'no null premiumKey rows');
  });
  
  await test('premiumSummary has no duplicates', async () => {
    const res = await makeRequest('GET', '/api/subscriptions/current/overview');
    const summary = res.body.data?.premiumSummary || [];
    const keys = summary.map(p => p.premiumKey).filter(Boolean);
    const uniqueKeys = new Set(keys);
    assertEqual(keys.length, uniqueKeys.size, 'no duplicates');
  });

  console.log('\n--- D) Premium Large Salad Checkout Contract ---\n');

  await test('Checkout accepts premium_large_salad in premiumItems', async () => {
    const idempotencyKey = `checkout_test_large_salad_${Date.now()}`;
    const checkoutPayload = {
      ...buildBaseSubscriptionPayload(),
      premiumItems: [
        { premiumKey: 'premium_large_salad', qty: 1 },
      ],
      idempotencyKey,
    };
    
    const res = await makeRequest('POST', '/api/subscriptions/checkout', checkoutPayload);
    assertEqual(res.status, 200, 'large salad checkout status');
    assertEqual(res.body.status, true, 'large salad checkout status field');
    const draft = await CheckoutDraft.findById(res.body.data?.draftId).lean();
    assertTrue(!!draft, 'large salad draft exists');
    assertEqual(draft.premiumItems.length, 1, 'one large salad premium item row');
    assertEqual(draft.premiumItems[0].premiumKey, 'premium_large_salad', 'large salad premiumKey canonical');
    assertEqual(draft.premiumItems[0].qty, 1, 'large salad draft qty preserved');
    assertEqual(draft.contractSnapshot?.entitlementContract?.premiumItems?.[0]?.premiumKey, 'premium_large_salad', 'large salad contract premiumKey canonical');
  });

  await test('Checkout accepts custom_premium_salad alias and stores premium_large_salad', async () => {
    const idempotencyKey = `checkout_test_custom_salad_${Date.now()}`;
    const checkoutPayload = {
      ...buildBaseSubscriptionPayload(),
      premiumItems: [
        { premiumKey: 'custom_premium_salad', qty: 1 },
      ],
      idempotencyKey,
    };

    const res = await makeRequest('POST', '/api/subscriptions/checkout', checkoutPayload);
    assertEqual(res.status, 200, 'legacy salad alias checkout status');
    assertEqual(res.body.status, true, 'legacy salad alias checkout status field');
    const draft = await CheckoutDraft.findById(res.body.data?.draftId).lean();
    assertTrue(!!draft, 'legacy salad alias draft exists');
    assertEqual(draft.premiumItems.length, 1, 'one normalized salad premium item row');
    assertEqual(draft.premiumItems[0].premiumKey, 'premium_large_salad', 'legacy salad alias stored canonical');
    assertEqual(draft.premiumItems[0].qty, 1, 'legacy salad alias draft qty preserved');
    assertEqual(draft.contractSnapshot?.entitlementContract?.premiumItems?.[0]?.premiumKey, 'premium_large_salad', 'legacy salad alias contract premiumKey canonical');

    const Payment = require('../src/models/Payment');
    const payment = new Payment({
      userId: testUser._id,
      draftId: draft._id,
      type: 'subscription_activation',
      amount: draft.breakdown.totalHalala,
      currency: 'SAR',
      status: 'paid',
      provider: 'moyasar',
      providerInvoiceId: `test_salad_invoice_${Date.now()}`,
      invoiceResponse: { id: `test_salad_invoice_${Date.now()}`, url: 'https://example.com/pay' },
    });
    await payment.save();

    const { finalizeSubscriptionDraftPaymentFlow } = require('../src/services/subscription/subscriptionActivationService');
    const result = await finalizeSubscriptionDraftPaymentFlow({ draft, payment }, null);
    assertTrue(result.applied, 'legacy salad alias activation applied');
    const subscription = await Subscription.findById(result.subscriptionId).lean();
    const saladRows = (subscription.premiumBalance || []).filter(p => p.premiumKey === 'premium_large_salad');
    assertEqual(saladRows.length, 1, 'no duplicate premium_large_salad balance rows');
    assertEqual(saladRows[0].purchasedQty, 1, 'salad balance purchased qty preserved');
    assertEqual(saladRows[0].remainingQty, 1, 'salad balance remaining qty preserved');
  });

  console.log('\n--- E) Reject Invalid Premium Item ---\n');

  await test('Quote rejects unknown premiumKey with 422', async () => {
    const quotePayload = {
      ...buildBaseSubscriptionPayload(),
      premiumItems: [
        { premiumKey: 'not_real_item', qty: 1 },
      ],
    };

    const res = await makeRequest('POST', '/api/subscriptions/quote', quotePayload);
    assertEqual(res.status, 422, 'rejects unknown premiumKey in quote with 422');
    assertEqual(res.body.error?.code, 'INVALID_PREMIUM_ITEM', 'quote returns INVALID_PREMIUM_ITEM');
  });

  await test('Checkout rejects invalid premiumMealId', async () => {
    const idempotencyKey = `checkout_test_invalid_${Date.now()}`;
    const checkoutPayload = {
      planId: String(testPlan._id),
      grams: 300,
      mealsPerDay: 2,
      startDate,
      delivery: {
        type: 'delivery',
        address: { street: 'Test Street', city: 'Riyadh' },
        zoneId: String(testZone._id),
        slot: { slotId: TEST_DELIVERY_SLOT_ID },
      },
      premiumItems: [
        { proteinId: '000000000000000000000999', qty: 1 },
      ],
      idempotencyKey,
    };
    
    const res = await makeRequest('POST', '/api/subscriptions/checkout', checkoutPayload);
    assertEqual(res.status, 422, 'rejects invalid premium with 422');
    assertEqual(res.body.error?.code, 'INVALID_PREMIUM_ITEM', 'returns INVALID_PREMIUM_ITEM');
  });

  await test('Checkout rejects unknown premiumKey with 422', async () => {
    const idempotencyKey = `checkout_test_unknown_key_${Date.now()}`;
    const checkoutPayload = {
      ...buildBaseSubscriptionPayload(),
      premiumItems: [
        { premiumKey: 'not_real_item', qty: 1 },
      ],
      idempotencyKey,
    };

    const res = await makeRequest('POST', '/api/subscriptions/checkout', checkoutPayload);
    assertEqual(res.status, 422, 'rejects unknown premiumKey in checkout with 422');
    assertEqual(res.body.error?.code, 'INVALID_PREMIUM_ITEM', 'checkout returns INVALID_PREMIUM_ITEM');
  });
  
  console.log('\n==========================================');
  console.log(`RESULTS: ${results.passed} passed, ${results.failed} failed, ${results.skipped} skipped`);
  console.log('==========================================\n');
  
  return results;
}

async function main() {
  try {
    await connectDatabase();
    
    // Enforce safety checks
    ensureSafeForDestructiveOp('checkout integration tests');

    console.log('Starting server...');
    await startServer();
    await wait(500);
    
    const results = await runTests();
    
    console.log('Cleaning up...');
    await stopServer();
    await cleanupTestData();
    await disconnectDatabase();
    
    console.log('\n--- Test Commands ---');
    console.log('node tests/checkout.integration.test.js');
    console.log('npm run test:checkout\n');
    
    process.exit(results.failed > 0 ? 1 : 0);
    
  } catch (err) {
    console.error('Test runner failed:', err.message);
    if (err.message === 'SKIP') {
      console.log('\n--- Test skipped ---');
      process.exit(0);
    }
    if (server) await stopServer();
    await disconnectDatabase();
    process.exit(1);
  }
}

main();
