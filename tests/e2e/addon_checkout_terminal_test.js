#!/usr/bin/env node
/**
 * E2E Integration Test: Addon Checkout Terminal Flow
 * 
 * Tests the real HTTP API exactly like Postman/Mobile would:
 * 1. Create test customer + subscription
 * 2. Seed addon balance (juice: 20 remaining)
 * 3. POST /selection/validate with 8 juice addon requests
 * 4. PUT /selection to save
 * 5. GET /current/overview to verify remaining balance
 * 
 * No mocks, no service calls, real Express routes + MongoDB
 */

const mongoose = require('mongoose');
const supertest = require('supertest');
require('dotenv').config();

// Models
const User = require('../../src/models/User');
const Subscription = require('../../src/models/Subscription');
const SubscriptionDay = require('../../src/models/SubscriptionDay');
const Plan = require('../../src/models/Plan');
const Addon = require('../../src/models/Addon');
const MenuProduct = require('../../src/models/MenuProduct');
const MenuCategory = require('../../src/models/MenuCategory');
const BuilderProtein = require('../../src/models/BuilderProtein');

// Import app
const { createApp } = require('../../src/app');
let app;

// Config
const MONGO_URI = process.env.MONGO_URI_TEST || process.env.MONGO_URI;
const KEEP_TEST_DATA = process.env.KEEP_TEST_DATA === 'true';

// Test Report
const report = {
  userId: null,
  subscriptionId: null,
  date: null,
  initialRemaining: 20,
  requested1: 8,
  requested2: 2,
  included1: 0,
  included2: 0,
  pending1: 0,
  pending2: 0,
  amountDue1: 0,
  amountDue2: 0,
  remainingAfterSave1: 0,
  remainingAfterSave2: 0,
  validateResponse1: null,
  validateResponse2: null,
  saveResponse1: null,
  saveResponse2: null,
  overviewResponse: null,
  subscriptionResponse: null,
  errors: [],
};

// ============================================================================
// Setup
// ============================================================================

async function connectDb() {
  if (!MONGO_URI) {
    throw new Error('MONGO_URI or MONGO_URI_TEST not set in .env');
  }
  await mongoose.connect(MONGO_URI, { dbName: 'basicdiet145' });
  console.log('✓ Connected to MongoDB:', MONGO_URI.split('@')[1]?.split('/')[0] || 'unknown');
}

async function disconnectDb() {
  if (mongoose.connection.readyState === 1) {
    await mongoose.disconnect();
    console.log('✓ Disconnected from MongoDB');
  }
}

// ============================================================================
// Fixtures
// ============================================================================

async function createTestUser() {
  const user = await User.create({
    phone: `+20100${Math.random().toString().slice(2, 9)}`,
    name: 'Test User E2E',
    role: 'client',
    otpVerified: true,
  });
  report.userId = user._id.toString();
  console.log('✓ Created user:', report.userId);
  return user;
}

async function createTestPlan() {
  const plan = await Plan.create({
    name: 'Test Plan E2E',
    grams: 500,
    mealsPerWeek: 7,
    mealsPerDay: 1,
    daysCount: 30,
    priceHalala: 150000,
    currency: 'SAR',
  });
  console.log('✓ Created plan:', plan._id.toString());
  return plan;
}

async function createTestAddon() {
  const addon = await Addon.create({
    name: {
      en: 'E2E Juice Category',
      ar: 'فئة العصير E2E',
    },
    category: 'juice',
    kind: 'plan',
    type: 'subscription',
    priceHalala: 0, // Free for entitlement
    currency: 'SAR',
    isActive: true,
  });
  console.log('✓ Created addon category:', addon._id.toString());
  return addon;
}

async function createTestMenuCategory() {
  // MenuCategory key must match sourceCategories in SUBSCRIPTION_ADDON_CHOICE_MAPPINGS
  // For juice addon: sourceCategories are ["juices", "drinks"]
  // Try to reuse existing "juices" category, if not found, create a new one
  let category = await MenuCategory.findOne({ key: 'juices' });
  if (category) {
    console.log('✓ Using existing menu category (juices):', category._id.toString());
    return category;
  }
  
  category = await MenuCategory.create({
    key: 'juices',
    name: {
      en: 'Juices E2E',
      ar: 'العصائر E2E',
    },
    isActive: true,
    isVisible: true,
    isAvailable: true,
    sortOrder: 1,
    publishedAt: new Date(),
  });
  console.log('✓ Created menu category:', category._id.toString());
  return category;
}

async function createTestMenuProducts(categoryId) {
  const timestamp = Date.now();
  const products = [];
  for (let i = 0; i < 8; i++) {
    const prod = await MenuProduct.create({
      categoryId,
      key: `juice_e2e_${timestamp}_${i}`,
      name: {
        en: `Juice Product ${i + 1}`,
        ar: `منتج عصير ${i + 1}`,
      },
      pricingModel: 'fixed',
      priceHalala: 30000,
      currency: 'SAR',
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: new Date(),
      kind: 'item', // NOT "plan"
      type: 'item', // NOT "subscription"
      itemType: 'product', // NOT "subscription"
      billingMode: 'one_time', // NOT "per_day"
      availableFor: 'one_time', // Explicitly mark as one-time addon
    });
    products.push(prod);
  }
  console.log(`✓ Created ${products.length} juice menu products`);
  return products;
}

async function createTestProtein() {
  // Not strictly needed for addon selection validation, but included for completeness
  // BuilderProtein creation requires BuilderCategory, so we skip it
  // Protein interaction is tested in separate canonical meal tests
  return { _id: new mongoose.Types.ObjectId() };
}

async function createTestSubscription(userId, planId, addonId, addonProductIds) {
  const startDate = new Date();
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 60); // 60 day subscription, plenty of time

  const subscription = await Subscription.create({
    userId,
    planId,
    status: 'active',
    startDate,
    endDate,
    validityEndDate: endDate,
    totalMeals: 60,
    remainingMeals: 60,
    deliveryMode: 'delivery',
    deliveryAddress: { city: 'Riyadh', line1: 'Test Address' },
    contractMode: 'canonical',
    contractVersion: '2.0',
    contractCompleteness: 'authoritative',
    basePlanPriceHalala: 150000,
    basePlanGrossHalala: 150000,
    basePlanNetHalala: 150000,
    subtotalHalala: 150000,
    subtotalBeforeVatHalala: 150000,
    vatPercentage: 0,
    vatHalala: 0,
    totalPriceHalala: 150000,
    checkoutCurrency: 'SAR',
    addonSubscriptions: [
      {
        addonId,
        addonPlanId: addonId,
        name: 'E2E Juice',
        category: 'juice',
        maxPerDay: 1,
        basePlanId: planId,
        priceHalala: 0,
        quantityPerDay: 1,
        purchasedDailyQty: 1,
        includedTotalQty: 20,
        unitPlanPriceHalala: 0,
        totalHalala: 0,
        currency: 'SAR',
        menuProductIds: addonProductIds,
        priceSource: 'test',
      },
    ],
    addonBalance: [
      {
        addonPlanId: addonId,
        addonId,
        name: 'E2E Juice',
        category: 'juice',
        purchasedDailyQty: 1,
        includedTotalQty: 20,
        purchasedQty: 0,
        consumedQty: 0,
        reservedQty: 0,
        remainingQty: 20,
        extraPurchasedQty: 0,
        overageConsumedQty: 0,
        unitIncludedPriceHalala: 0,
        overageUnitPriceHalala: 30000,
        unitPriceHalala: 0,
        currency: 'SAR',
      },
    ],
  });

  report.subscriptionId = subscription._id.toString();
  console.log('✓ Created subscription:', report.subscriptionId);
  return subscription;
}

function generateJWT(userId) {
  // Use the app's token service to generate a valid JWT
  const { issueAppAccessToken } = require('../../src/services/appTokenService');
  const token = issueAppAccessToken({ _id: userId });
  console.log('✓ Generated JWT for user');
  return token;
}

// ============================================================================
// HTTP Calls
// ============================================================================

async function callValidateEndpoint(token, subscriptionId, date, addonProductIds, scenarioNum = 1) {
  // Minimal payload - just validate addon selections without meal slots
  // This tests the addon balance consumption path in isolation
  const payload = {
    mealSlots: [],
    addonsOneTime: addonProductIds, // API expects addonsOneTime, not requestedOneTimeAddonIds
  };

  const res = await supertest(app)
    .post(`/api/subscriptions/${subscriptionId}/days/${date}/selection/validate`)
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'application/json')
    .send(payload);

  report[`validateResponse${scenarioNum}`] = {
    status: res.status,
    body: res.body,
  };

  console.log(`\n--- POST /selection/validate (Scenario ${scenarioNum}) ---`);
  console.log('Status:', res.status);
  console.log('Response:', JSON.stringify(res.body, null, 2).substring(0, 500));

  // API response structure: { status: true, data: { addonSelections: [...] } }
  if (res.body && res.body.data && res.body.data.addonSelections) {
    report[`included${scenarioNum}`] = res.body.data.addonSelections.filter(s => s.source === 'subscription').length;
    report[`pending${scenarioNum}`] = res.body.data.addonSelections.filter(s => s.source === 'pending_payment').length;
  }

  if (res.body && res.body.data && res.body.data.paymentRequirement) {
    report[`amountDue${scenarioNum}`] = res.body.data.paymentRequirement.pendingAmountHalala || 0;
  }

  return res;
}

async function callSaveEndpoint(token, subscriptionId, date, addonProductIds, scenarioNum = 1) {
  const payload = {
    mealSlots: [],
    addonsOneTime: addonProductIds, // API expects addonsOneTime, not requestedOneTimeAddonIds
  };

  const res = await supertest(app)
    .put(`/api/subscriptions/${subscriptionId}/days/${date}/selection`)
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'application/json')
    .send(payload);

  report[`saveResponse${scenarioNum}`] = {
    status: res.status,
    body: res.body,
  };

  console.log(`\n--- PUT /selection (Scenario ${scenarioNum}) ---`);
  console.log('Status:', res.status);
  console.log('Response:', JSON.stringify(res.body, null, 2).substring(0, 500));

  return res;
}

async function callOverviewEndpoint(token) {
  const res = await supertest(app)
    .get('/api/subscriptions/current/overview')
    .set('Authorization', `Bearer ${token}`);

  report.overviewResponse = {
    status: res.status,
    body: res.body,
  };

  console.log('\n--- GET /current/overview ---');
  console.log('Status:', res.status);
  console.log('Response:', JSON.stringify(res.body, null, 2).substring(0, 500));

  if (res.body && res.body.addons) {
    console.log('Found addons at res.body.addons');
    const juiceBalance = res.body.addons.find(a => a.category === 'juice');
    if (juiceBalance) {
      report.remainingAfterSave = juiceBalance.remainingUnits;
    }
  } else if (res.body && res.body.data && res.body.data.addons) {
    console.log('Found addons at res.body.data.addons');
    const juiceBalance = res.body.data.addons.find(a => a.category === 'juice');
    if (juiceBalance) {
      report.remainingAfterSave = juiceBalance.remainingUnits;
    }
  } else if (res.body && res.body.data && res.body.data.addonBalances) {
    console.log('Found addonBalances at res.body.data.addonBalances');
    const juiceBalance = res.body.data.addonBalances.find(a => a.category === 'juice');
    if (juiceBalance) {
      report.remainingAfterSave = juiceBalance.remainingQty !== undefined ? juiceBalance.remainingQty : juiceBalance.remainingUnits;
    }
  } else if (res.body && res.body.data && res.body.data.addonBalance && res.body.data.addonBalance.juice) {
    console.log('Found addonBalance at res.body.data.addonBalance.juice');
    report.remainingAfterSave = res.body.data.addonBalance.juice.remainingUnits;
  } else {
    console.log('No addons found in response');
  }

  return res;
}

async function callSubscriptionEndpoint(token, subscriptionId) {
  const res = await supertest(app)
    .get(`/api/subscriptions/${subscriptionId}`)
    .set('Authorization', `Bearer ${token}`);

  report.subscriptionResponse = {
    status: res.status,
    body: res.body,
  };

  console.log('\n--- GET /subscriptions/:id ---');
  console.log('Status:', res.status);
  if (res.body && res.body.subscription && res.body.subscription.addons) {
    console.log('Addon Balances:', JSON.stringify(res.body.subscription.addons, null, 2));
  }

  return res;
}

// ============================================================================
// Assertions
// ============================================================================

function assert(condition, message) {
  if (!condition) {
    report.errors.push(message);
    console.error('✗ FAIL:', message);
  } else {
    console.log('✓ PASS:', message);
  }
}

function runAssertions() {
  console.log('\n========== ASSERTIONS ==========\n');

  assert(
    report.validateResponse1.status === 200,
    `Validate 1 endpoint returned ${report.validateResponse1.status}, expected 200`
  );

  assert(
    report.validateResponse1.body.data && report.validateResponse1.body.data.valid === true,
    `Validate 1 response valid = ${report.validateResponse1.body.data && report.validateResponse1.body.data.valid}`
  );

  assert(
    report.included1 === report.requested1,
    `${report.included1} addons included in Validate 1 (expected ${report.requested1})`
  );

  assert(
    report.pending1 === 0,
    `${report.pending1} addons pending in Validate 1 (expected 0)`
  );

  assert(
    report.amountDue1 === 0,
    `Payment due in Validate 1: ${report.amountDue1} (expected 0)`
  );

  assert(
    report.saveResponse1.status === 200,
    `Save 1 endpoint returned ${report.saveResponse1.status}, expected 200`
  );

  assert(
    report.remainingAfterSave1 === 12,
    `Remaining after first save: ${report.remainingAfterSave1} (expected 12)`
  );

  assert(
    report.validateResponse2.status === 200,
    `Validate 2 endpoint returned ${report.validateResponse2.status}, expected 200`
  );

  assert(
    report.validateResponse2.body.data && report.validateResponse2.body.data.valid === true,
    `Validate 2 response valid = ${report.validateResponse2.body.data && report.validateResponse2.body.data.valid}`
  );

  assert(
    report.included2 === report.requested2,
    `${report.included2} addons included in Validate 2 (expected ${report.requested2})`
  );

  assert(
    report.pending2 === 0,
    `${report.pending2} addons pending in Validate 2 (expected 0)`
  );

  assert(
    report.amountDue2 === 0,
    `Payment due in Validate 2: ${report.amountDue2} (expected 0)`
  );

  assert(
    report.saveResponse2.status === 200,
    `Save 2 endpoint returned ${report.saveResponse2.status}, expected 200`
  );

  assert(
    report.remainingAfterSave2 === 10,
    `Remaining after second save: ${report.remainingAfterSave2} (expected 10)`
  );

  assert(
    report.overviewResponse.status === 200,
    `Overview endpoint returned ${report.overviewResponse.status}, expected 200`
  );

  assert(
    report.subscriptionResponse.status === 200,
    `Subscription endpoint returned ${report.subscriptionResponse.status}, expected 200`
  );
}

// ============================================================================
// Cleanup
// ============================================================================

async function cleanup(userId, subscriptionId) {
  if (KEEP_TEST_DATA) {
    console.log('\n⚠ KEEP_TEST_DATA=true, skipping cleanup');
    return;
  }

  try {
    await User.deleteOne({ _id: userId });
    await Subscription.deleteOne({ _id: subscriptionId });
    await SubscriptionDay.deleteMany({ subscriptionId });
    await MenuProduct.deleteMany({ key: /^juice_e2e_/ });
    await MenuCategory.deleteMany({ key: /^juice_e2e_/ });
    await Addon.deleteMany({ category: 'juice', 'name.en': /E2E/ });
    console.log('✓ Cleaned up test data');
  } catch (err) {
    console.error('Error during cleanup:', err.message);
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  try {
    console.log('========== E2E ADDON CHECKOUT TEST ==========\n');

    // Connect & Initialize app
    await connectDb();
    app = createApp();

    // Create fixtures
    const user = await createTestUser();
    const plan = await createTestPlan();
    const addon = await createTestAddon();
    const menuCategory = await createTestMenuCategory();
    const addonProducts = await createTestMenuProducts(menuCategory._id);
    const protein = await createTestProtein();
    const subscription = await createTestSubscription(
      user._id,
      plan._id,
      addon._id,
      // Reproduce the production mismatch: the entitlement snapshot contains
      // only three products while the category catalog and balance allow more.
      addonProducts.slice(0, 3).map(p => p._id)
    );

    // Generate JWT
    const token = generateJWT(user._id);

    // Get date (KSA timezone, use a day in the future where delivery is typically available)
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 5); // Add 5 days to be well into the future
    const dateStr = futureDate.toISOString().split('T')[0]; // YYYY-MM-DD
    report.date = dateStr;

    console.log('\n========== TEST EXECUTION ==========\n');

    // Call endpoints (Scenario 1)
    const validateRes = await callValidateEndpoint(
      token,
      subscription._id,
      dateStr,
      addonProducts.map(p => p._id),
      1
    );

    if (validateRes.status !== 200) {
      throw new Error(`Validate failed with status ${validateRes.status}`);
    }

    const saveRes = await callSaveEndpoint(
      token,
      subscription._id,
      dateStr,
      addonProducts.map(p => p._id),
      1
    );

    if (saveRes.status === 402) {
      throw new Error('Save returned 402 Payment Required (addon balance not consumed)');
    }

    const overviewRes = await callOverviewEndpoint(token);
    report.remainingAfterSave1 = report.remainingAfterSave;

    // --- Scenario 2: Save 2 more addon selections on a different date (futureDate + 1 day) ---
    const dateStr2 = new Date(futureDate);
    dateStr2.setDate(dateStr2.getDate() + 1);
    const dateStr2Formatted = dateStr2.toISOString().split('T')[0];

    console.log(`\nScenario 2: Validate & Save 2 juices on a different date (${dateStr2Formatted})`);

    const validateRes2 = await callValidateEndpoint(
      token,
      subscription._id,
      dateStr2Formatted,
      addonProducts.slice(0, 2).map(p => p._id),
      2
    );

    if (validateRes2.status !== 200) {
      throw new Error(`Second Validate failed with status ${validateRes2.status}`);
    }

    const saveRes2 = await callSaveEndpoint(
      token,
      subscription._id,
      dateStr2Formatted,
      addonProducts.slice(0, 2).map(p => p._id),
      2
    );

    if (saveRes2.status === 402) {
      throw new Error('Second Save returned 402 Payment Required');
    }

    const overviewRes2 = await callOverviewEndpoint(token);
    report.remainingAfterSave2 = report.remainingAfterSave;

    const subscriptionRes = await callSubscriptionEndpoint(token, subscription._id);

    // Run assertions
    runAssertions();

    // Print report
    console.log('\n========== TEST REPORT ==========\n');
    console.log('User ID:', report.userId);
    console.log('Subscription ID:', report.subscriptionId);
    console.log('Date:', report.date);
    console.log('Initial Remaining:', report.initialRemaining);
    console.log('Requested 1:', report.requested1);
    console.log('Included 1:', report.included1);
    console.log('Pending 1:', report.pending1);
    console.log('Amount Due 1:', report.amountDue1);
    console.log('Remaining After Save 1:', report.remainingAfterSave1);
    console.log('Requested 2:', report.requested2);
    console.log('Included 2:', report.included2);
    console.log('Pending 2:', report.pending2);
    console.log('Amount Due 2:', report.amountDue2);
    console.log('Remaining After Save 2:', report.remainingAfterSave2);
    console.log('');

    const passed = report.errors.length === 0;
    console.log(passed ? '✓ PASS' : '✗ FAIL');

    if (report.errors.length > 0) {
      console.log('\nErrors:');
      report.errors.forEach((err, i) => console.log(`  ${i + 1}. ${err}`));
    }

    // Cleanup
    await cleanup(user._id, subscription._id);

    // Exit
    await disconnectDb();
    process.exit(passed ? 0 : 1);
  } catch (err) {
    console.error('\n✗ TEST ERROR:', err.message);
    console.error(err.stack);
    await disconnectDb();
    process.exit(1);
  }
}

main();
