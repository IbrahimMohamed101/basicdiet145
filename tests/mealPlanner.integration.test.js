/**
 * Meal Planner Integration Tests
 * 
 * Tests the complete meal planner backend cycle:
 * Catalog → Day Load → Validate → Save → Payment → Verify → Confirm → Overview
 * 
 * Run with: node tests/mealPlanner.integration.test.js
 */

require('dotenv').config();

const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const http = require('http');

const { createApp } = require('../src/app');
const User = require('../src/models/User');
const Subscription = require('../src/models/Subscription');
const SubscriptionDay = require('../src/models/SubscriptionDay');
const BuilderProtein = require('../src/models/BuilderProtein');
const BuilderCarb = require('../src/models/BuilderCarb');
const BuilderCategory = require('../src/models/BuilderCategory');
const Addon = require('../src/models/Addon');
const Plan = require('../src/models/Plan');
const Meal = require('../src/models/Meal');
const MealCategory = require('../src/models/MealCategory');
const SaladIngredient = require('../src/models/SaladIngredient');

const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';
const BASE_URL = 'http://localhost:3000';

function issueAppAccessToken(userId) {
  return jwt.sign(
    { userId: String(userId), role: 'client', tokenType: 'app_access' },
    JWT_SECRET,
    { expiresIn: '31d' }
  );
}

const isTestEnv = process.env.NODE_ENV === 'test';

let server = null;
let app = null;
let testUser = null;
let testSubscription = null;
let authToken = null;
let builderCategory = null;
let standardProtein = null;
let premiumProteinShrimp = null;
let premiumProteinBeefSteak = null;
let premiumProteinSalmon = null;
let standardCarb = null;
let unavailableProtein = null;
let unavailableCarb = null;
let sandwichMeal = null;
let nonSandwichMeal = null;
let addonJuicePlan = null;
let addonJuice = null;
let addonJuice2 = null;
let addonSnack = null;
let addonSmallSalad = null;
let addonInactive = null;
let testPlan = null;

const TEST_USER_PHONE = '+966501234567';
const TEST_USER_PASSWORD = 'testpassword123';
const CUSTOM_PREMIUM_SALAD_KEY = 'custom_premium_salad';
const CUSTOM_PREMIUM_SALAD_FIXED_PRICE = 3000;

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

function assertArray(actual, msg) {
  if (!Array.isArray(actual)) throw new Error(`${msg || 'Assertion failed'}: expected array`);
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

async function getActiveSubscriptionDay(date) {
  if (!testSubscription) return null;
  return SubscriptionDay.findOne({ subscriptionId: testSubscription._id, date }).lean();
}

async function createTestUserAndAuthenticate() {
  // Find existing user or create new one with correct fields
  let user = await User.findOne({ phone: TEST_USER_PHONE });
  if (!user) {
    const bcrypt = require('bcryptjs');
    const hashedPassword = await bcrypt.hash(TEST_USER_PASSWORD, 10);
    user = new User({
      phone: TEST_USER_PHONE,
      name: 'Test User',
      password: hashedPassword,
      role: 'client',
      isActive: true,
    });
    await user.save();
  } else {
    // Ensure existing user has correct fields
    user.name = user.name || 'Test User';
    user.role = 'client';
    user.isActive = true;
    await user.save();
  }
  testUser = user;
  
  // Generate token using the same method as backend
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

  const largeSaladCategory = await BuilderCategory.findOne({ dimension: 'carb', key: 'large_salad' });
  let largeSaladCat = largeSaladCategory;
  if (!largeSaladCat) {
    largeSaladCat = new BuilderCategory({
      key: 'large_salad', dimension: 'carb',
      name: { ar: 'سلطة مميزة', en: 'Large Salad' },
      description: { ar: 'سلطة مميزة', en: 'Large Premium Salad' },
      isActive: true, sortOrder: 10,
    });
    await largeSaladCat.save();
  }

  const baseProtein = { displayCategoryId: builderCategory._id, displayCategoryKey: builderCategory.key, isActive: true, availableForSubscription: true };

  standardProtein = await BuilderProtein.findOne({
    isPremium: false,
    isActive: true,
    availableForSubscription: { $ne: false },
    premiumKey: { $exists: true, $ne: null },
  })
    || await BuilderProtein.findOne({
      isPremium: false,
      isActive: true,
      availableForSubscription: { $ne: false },
    });
  if (!standardProtein) {
    standardProtein = new BuilderProtein({
      ...baseProtein, name: { ar: 'دجاج', en: 'Chicken' }, description: { ar: 'دجاج مشوي', en: 'Grilled chicken' },
      proteinFamilyKey: 'chicken', ruleTags: [],
      isPremium: false, premiumKey: 'chicken', extraFeeHalala: 0, currency: 'SAR',
    });
    await standardProtein.save();
  }

  premiumProteinShrimp = await BuilderProtein.findOne({ premiumKey: 'shrimp' });
  if (!premiumProteinShrimp) {
    premiumProteinShrimp = new BuilderProtein({
      ...baseProtein, name: { ar: 'جمبري', en: 'Shrimp' }, description: { ar: 'جمبري مشوي', en: 'Grilled shrimp' },
      proteinFamilyKey: 'seafood', ruleTags: ['premium'],
      isPremium: true, premiumKey: 'shrimp', extraFeeHalala: 1500, currency: 'SAR',
    });
    await premiumProteinShrimp.save();
  }

  premiumProteinBeefSteak = await BuilderProtein.findOne({ premiumKey: 'beef_steak' });
  if (!premiumProteinBeefSteak) {
    premiumProteinBeefSteak = new BuilderProtein({
      ...baseProtein, name: { ar: 'ستيك لحم', en: 'Beef Steak' }, description: { ar: 'ستيك لحم مشوي', en: 'Grilled beef steak' },
      proteinFamilyKey: 'beef', ruleTags: ['premium'],
      isPremium: true, premiumKey: 'beef_steak', extraFeeHalala: 2000, currency: 'SAR',
    });
    await premiumProteinBeefSteak.save();
  }

  premiumProteinSalmon = await BuilderProtein.findOne({ premiumKey: 'salmon' });
  if (!premiumProteinSalmon) {
    premiumProteinSalmon = new BuilderProtein({
      ...baseProtein, name: { ar: 'سلمون', en: 'Salmon' }, description: { ar: 'سلمون مشوي', en: 'Grilled salmon' },
      proteinFamilyKey: 'seafood', ruleTags: ['premium'],
      isPremium: true, premiumKey: 'salmon', extraFeeHalala: 1800, currency: 'SAR',
    });
    await premiumProteinSalmon.save();
  }

  standardCarb = await BuilderCarb.findOne({
    displayCategoryKey: { $ne: 'large_salad' },
    isActive: true,
    availableForSubscription: { $ne: false },
  });
  if (!standardCarb) {
    standardCarb = new BuilderCarb({
      displayCategoryId: builderCategory._id, displayCategoryKey: builderCategory.key,
      name: { ar: 'أرز', en: 'Rice' }, description: { ar: 'أرز steamed', en: 'Steamed rice' },
      isActive: true, availableForSubscription: true,
    });
    await standardCarb.save();
  }

  let largeSaladCarb = await BuilderCarb.findOne({ displayCategoryKey: 'large_salad' });
  if (!largeSaladCarb) {
    largeSaladCarb = new BuilderCarb({
      displayCategoryId: largeSaladCat._id, displayCategoryKey: 'large_salad',
      name: { ar: 'سلطة مميزة', en: 'Custom Premium Salad' },
      description: { ar: 'سلطة مميزة', en: 'Custom Premium Salad Carb' },
      isActive: true, availableForSubscription: true,
    });
    await largeSaladCarb.save();
  }

  unavailableProtein = await BuilderProtein.findOne({ premiumKey: 'inactive_test_protein' });
  if (!unavailableProtein) {
    unavailableProtein = new BuilderProtein({
      ...baseProtein,
      name: { ar: 'بروتين غير متاح', en: 'Unavailable Protein' },
      description: { ar: 'غير متاح', en: 'Unavailable protein' },
      proteinFamilyKey: 'chicken',
      ruleTags: [],
      isPremium: false,
      premiumKey: 'inactive_test_protein',
      extraFeeHalala: 0,
      currency: 'SAR',
      availableForSubscription: false,
    });
    await unavailableProtein.save();
  }

  unavailableCarb = await BuilderCarb.findOne({ name: { en: 'Unavailable Carb' } });
  if (!unavailableCarb) {
    unavailableCarb = new BuilderCarb({
      displayCategoryId: builderCategory._id,
      displayCategoryKey: builderCategory.key,
      name: { ar: 'كارب غير متاح', en: 'Unavailable Carb' },
      description: { ar: 'غير متاح', en: 'Unavailable carb' },
      isActive: true,
      availableForSubscription: false,
    });
    await unavailableCarb.save();
  }

  const GROUP_ORDER = { vegetables: 1, addons: 2, fruits: 3, nuts: 4, sauce: 5 };
  const SEED_INGREDIENTS = [
    { name: { ar: 'بصل مخلل', en: 'Pickled Onion' }, groupKey: 'vegetables' },
    { name: { ar: 'نعناع', en: 'Mint' }, groupKey: 'vegetables' },
    { name: { ar: 'زيتون أسود', en: 'Black Olive' }, groupKey: 'vegetables' },
    { name: { ar: 'زيتون أخضر', en: 'Green Olive' }, groupKey: 'vegetables' },
    { name: { ar: 'بروكلي', en: 'Broccoli' }, groupKey: 'vegetables' },
    { name: { ar: 'فطر', en: 'Mushroom' }, groupKey: 'vegetables' },
    { name: { ar: 'كزبرة', en: 'Coriander' }, groupKey: 'vegetables' },
    { name: { ar: 'فلفل', en: 'Pepper' }, groupKey: 'vegetables' },
    { name: { ar: 'بنجر', en: 'Beet' }, groupKey: 'vegetables' },
    { name: { ar: 'هالينو', en: 'Jalapeno' }, groupKey: 'vegetables' },
    { name: { ar: 'بارميزان', en: 'Parmesan' }, groupKey: 'addons' },
    { name: { ar: 'فيتا', en: 'Feta' }, groupKey: 'addons' },
    { name: { ar: 'تمر', en: 'Dates' }, groupKey: 'fruits' },
    { name: { ar: 'توت أزرق', en: 'Blueberry' }, groupKey: 'fruits' },
    { name: { ar: 'فراولة', en: 'Strawberry' }, groupKey: 'fruits' },
    { name: { ar: 'رمان', en: 'Pomegranate' }, groupKey: 'fruits' },
    { name: { ar: 'سمسم', en: 'Sesame' }, groupKey: 'nuts' },
    { name: { ar: 'كاجو', en: 'Cashew' }, groupKey: 'nuts' },
    { name: { ar: 'عين الجمل', en: 'Walnut' }, groupKey: 'nuts' },
    { name: { ar: 'عسل بالليمون', en: 'Honey Lemon' }, groupKey: 'sauce' },
    { name: { ar: 'زبادي بالنعناع', en: 'Yogurt Mint' }, groupKey: 'sauce' },
    { name: { ar: 'هاني ماستر', en: 'Honey Mustard' }, groupKey: 'sauce' },
    { name: { ar: 'صوص بيستو', en: 'Pesto Sauce' }, groupKey: 'sauce' },
    { name: { ar: 'سيزر', en: 'Caesar' }, groupKey: 'sauce' },
    { name: { ar: 'رانش', en: 'Ranch' }, groupKey: 'sauce' },
  ];

  const existingCount = await SaladIngredient.countDocuments({});
  if (existingCount === 0) {
    for (let i = 0; i < SEED_INGREDIENTS.length; i++) {
      const ing = SEED_INGREDIENTS[i];
      await SaladIngredient.create({
        name: ing.name,
        groupKey: ing.groupKey,
        price: 0,
        calories: 50,
        isActive: true,
        sortOrder: GROUP_ORDER[ing.groupKey] + (i * 0.01),
      });
    }
  }

  let sandwichCategory = await MealCategory.findOne({ key: 'sandwich' });
  if (!sandwichCategory) {
    sandwichCategory = new MealCategory({
      key: 'sandwich',
      name: { ar: 'ساندويتش', en: 'Sandwich' },
      isActive: true,
    });
    await sandwichCategory.save();
  }

  sandwichMeal = await Meal.findOne({ categoryId: sandwichCategory._id, isActive: true }) || await Meal.findOne({ name: { $regex: /sandwich/i } });
  if (!sandwichMeal) {
    sandwichMeal = new Meal({
      name: { ar: 'ساندويتش', en: 'Sandwich' }, description: { ar: 'ساندويتش', en: 'Sandwich meal' },
      categoryId: sandwichCategory._id, type: 'regular', isActive: true, availableForSubscription: true,
    });
    await sandwichMeal.save();
  } else if (!sandwichMeal.categoryId) {
    sandwichMeal.categoryId = sandwichCategory._id;
    await sandwichMeal.save();
  }

  let bowlCategory = await MealCategory.findOne({ key: 'bowl' });
  if (!bowlCategory) {
    bowlCategory = new MealCategory({
      key: 'bowl',
      name: { ar: 'باول', en: 'Bowl' },
      isActive: true,
    });
    await bowlCategory.save();
  }

  nonSandwichMeal = await Meal.findOne({ categoryId: bowlCategory._id, isActive: true });
  if (!nonSandwichMeal) {
    nonSandwichMeal = new Meal({
      name: { ar: 'باول دجاج', en: 'Chicken Bowl' },
      description: { ar: 'طبق عادي', en: 'Regular bowl meal' },
      categoryId: bowlCategory._id,
      type: 'regular',
      isActive: true,
      availableForSubscription: true,
    });
    await nonSandwichMeal.save();
  }

  addonJuicePlan = await Addon.findOne({ kind: 'plan', category: 'juice', billingMode: 'per_day' });
  if (!addonJuicePlan) {
    addonJuicePlan = new Addon({
      name: { ar: 'اشتراك العصير', en: 'Juice Subscription' },
      category: 'juice',
      kind: 'plan',
      billingMode: 'per_day',
      priceHalala: 1000,
      isActive: true,
    });
    await addonJuicePlan.save();
  }

  addonJuice = await Addon.findOne({ kind: 'item', category: 'juice', billingMode: 'flat_once', isActive: true });
  if (!addonJuice) {
    addonJuice = new Addon({
      name: { ar: 'عصير التوت', en: 'Berry Blast' }, category: 'juice', kind: 'item',
      priceHalala: 1000, isActive: true,
    });
    await addonJuice.save();
  }

  addonJuice2 = await Addon.findOne({ kind: 'item', category: 'juice', billingMode: 'flat_once', isActive: true, _id: { $ne: addonJuice._id } });
  if (!addonJuice2) {
    addonJuice2 = new Addon({
      name: { ar: 'ماء', en: 'Water' }, category: 'juice', kind: 'item',
      priceHalala: 500, isActive: true,
    });
    await addonJuice2.save();
  }

  addonSnack = await Addon.findOne({ kind: 'item', category: 'snack', billingMode: 'flat_once', isActive: true });
  if (!addonSnack) {
    addonSnack = new Addon({
      name: { ar: 'بروتين بار', en: 'Protein Bar' }, category: 'snack', kind: 'item',
      priceHalala: 1500, isActive: true,
    });
    await addonSnack.save();
  }

  addonSmallSalad = await Addon.findOne({ kind: 'item', category: 'small_salad', billingMode: 'flat_once', isActive: true });
  if (!addonSmallSalad) {
    addonSmallSalad = new Addon({
      name: { ar: 'سلطة صغيرة', en: 'Small Salad' }, category: 'small_salad', kind: 'item',
      priceHalala: 1200, isActive: true,
    });
    await addonSmallSalad.save();
  }

  addonInactive = await Addon.findOne({ kind: 'item', category: 'juice', billingMode: 'flat_once', isActive: false });
  if (!addonInactive) {
    addonInactive = new Addon({
      name: { ar: 'عنصر غير نشط', en: 'Inactive Juice Item' }, category: 'juice', kind: 'item',
      priceHalala: 900, isActive: false,
    });
    await addonInactive.save();
  }
}

async function createTestSubscription() {
  testPlan = await Plan.findOne({ name: { $regex: /basic/i } });
  if (!testPlan) {
    testPlan = new Plan({
      name: { ar: 'بسيك', en: 'Basic' }, description: { ar: 'خطة أساسية', en: 'Basic plan' },
      mealsPerDay: 2, daysCount: 28, priceHalala: 49000, currency: 'SAR', isActive: true, sortOrder: 1,
    });
    await testPlan.save();
  }
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() + 1);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 28);
  
  const mealsPerDay = testPlan.mealsPerDay || 2;
  const daysCount = testPlan.daysCount || 28;
  const totalMeals = mealsPerDay * daysCount;
  
  const subscription = new Subscription({
    userId: testUser._id, planId: testPlan._id, selectedMealsPerDay: mealsPerDay,
    startDate: startDate, endDate: endDate, status: 'active',
    totalMeals: totalMeals,
    remainingMeals: totalMeals,
    deliveryMode: 'pickup',
    premiumBalance: [
      { proteinId: premiumProteinShrimp._id, premiumKey: 'shrimp', purchasedQty: 2, remainingQty: 2, unitExtraFeeHalala: 1500, currency: 'SAR' },
      { proteinId: premiumProteinBeefSteak._id, premiumKey: 'beef_steak', purchasedQty: 1, remainingQty: 1, unitExtraFeeHalala: 2000, currency: 'SAR' },
      { proteinId: premiumProteinSalmon._id, premiumKey: 'salmon', purchasedQty: 1, remainingQty: 0, unitExtraFeeHalala: 1800, currency: 'SAR' },
      { proteinId: premiumProteinShrimp._id, premiumKey: CUSTOM_PREMIUM_SALAD_KEY, purchasedQty: 1, remainingQty: 1, unitExtraFeeHalala: 3000, currency: 'SAR' },
    ],
    addonSubscriptions: [
      { addonId: addonJuicePlan._id, category: 'juice', includedCount: 1, maxPerDay: 1, status: 'active' },
    ],
  });
  await subscription.save();
  testSubscription = subscription;
}

async function cleanupTestData() {
  if (testSubscription) {
    await SubscriptionDay.deleteMany({ subscriptionId: testSubscription._id });
    await Subscription.deleteOne({ _id: testSubscription._id });
  }
  if (testUser) await User.deleteOne({ _id: testUser._id });
  testSubscription = null; testUser = null; authToken = null;
}

async function startServer() {
  return new Promise((resolve, reject) => {
    app = createApp();
    server = http.createServer(app);
    server.listen(3000, () => { resolve(); });
    server.on('error', reject);
  });
}

async function stopServer() {
  if (server) {
    return new Promise(resolve => { server.close(() => resolve()); });
  }
}

async function connectDatabase() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/basicdiet_test';
  if (mongoose.connection.readyState === 1) return;
  if (mongoose.connection.readyState === 2) { await mongoose.connection.asPromise(); return; }
  try {
    await mongoose.connect(mongoUri);
  } catch (err) {
    if (err.message.includes('ECONNREFUSED') || err.message.includes('Authentication failed')) {
      console.error('\n❌ MongoDB connection failed!');
      console.error('Please set MONGO_URI or MONGODB_URI environment variable\n');
      throw new Error('SKIP');
    }
    throw err;
  }
}

async function disconnectDatabase() {
  await mongoose.disconnect();
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
  console.log('MEAL PLANNER INTEGRATION TESTS');
  console.log('==========================================\n');
  
  const d = new Date();
  const TEST_DATE = buildDateOffset(2);
  const TEST_DATE2 = buildDateOffset(4);
  const TEST_DATE3 = buildDateOffset(6);
  const TEST_DATE4 = buildDateOffset(8);
  const TEST_DATE5 = buildDateOffset(10);
  const TEST_DATE6 = buildDateOffset(12);
  const TEST_DATE_IDEM = buildDateOffset(14);
  const TEST_DATE_BULK1 = buildDateOffset(16);
  const TEST_DATE_BULK2 = buildDateOffset(18);
  const TEST_DATE7 = buildDateOffset(20);
  const TEST_DATE8 = buildDateOffset(22);
  const TEST_DATE_BEFORE = buildDateOffset(0);
  
  console.log('Test dates:', TEST_DATE, TEST_DATE2, TEST_DATE3, TEST_DATE4);
  console.log('\n--- Setup ---\n');
  
  await createTestUserAndAuthenticate();
  console.log('✅ Test user created');
  await seedBuilderCatalog();
  console.log('✅ Builder catalog seeded');
  await createTestSubscription();
  console.log('✅ Test subscription created');
  
  // Auth smoke test
  console.log('\n--- Auth Smoke Test ---\n');
  try {
    const smokeRes = await makeRequest('GET', '/api/subscriptions/current/overview');
    if (smokeRes.status === 401) {
      console.log('❌ Auth smoke test FAILED: 401 Unauthorized');
      throw new Error('Auth smoke test failed');
    }
    console.log('✅ Auth smoke test passed');
  } catch (err) {
    console.log('❌ Auth smoke test failed:', err.message);
    throw err;
  }
  
  console.log('\n--- A) Meal Planner Menu ---\n');
  await test('GET /meal-planner-menu returns builderCatalog', async () => {
    const res = await makeRequest('GET', '/api/subscriptions/meal-planner-menu');
    assertEqual(res.status, 200, 'status');
    assertEqual(res.body.status, true, 'status');
    assertNoTopLevelOk(res.body, 'meal-planner-menu response');
    assertTrue(!!res.body.data?.builderCatalog, 'builderCatalog');
  });

  await test('meal-planner-menu addons contain only item add-ons', async () => {
    const res = await makeRequest('GET', '/api/subscriptions/meal-planner-menu');
    const addons = res.body.data?.addons?.items || [];
    assertTrue(addons.length > 0, 'addons returned');
    assertTrue(addons.every((addon) => addon.kind === 'item'), 'all planner addons are items');
    assertTrue(!addons.some((addon) => addon.id === String(addonJuicePlan._id)), 'plan add-on excluded');
    assertTrue(addons.some((addon) => addon.id === String(addonJuice._id)), 'juice item included');
  });
  
  await test('builderCatalog has proteins with premiumKey', async () => {
    const res = await makeRequest('GET', '/api/subscriptions/meal-planner-menu');
    const premiumProteins = res.body.data?.builderCatalog?.premiumProteins || [];
    const shrimp = premiumProteins.find(p => p.premiumKey === 'shrimp');
    assertTrue(!!shrimp, 'Shrimp has premiumKey in premiumProteins');
  });
  
  await test('builderCatalog has premiumLargeSalad', async () => {
    const res = await makeRequest('GET', '/api/subscriptions/meal-planner-menu');
    const salad = res.body.data?.builderCatalog?.premiumLargeSalad;
    assertTrue(!!salad, 'premiumLargeSalad present');
    assertEqual(salad?.extraFeeHalala, CUSTOM_PREMIUM_SALAD_FIXED_PRICE, 'fixed price');
    assertEqual(salad?.premiumKey, CUSTOM_PREMIUM_SALAD_KEY, 'premiumKey is custom_premium_salad');
    assertEqual(salad?.selectionType, 'premium_large_salad', 'selectionType is premium_large_salad');
    const groupKeys = (salad?.groups || []).map(g => g.key);
    assertTrue(groupKeys.includes('vegetables'), 'groups includes vegetables');
    assertTrue(groupKeys.includes('sauce'), 'groups includes sauce');
    assertTrue(groupKeys.includes('protein'), 'groups includes protein');
    const sauceGroup = salad?.groups?.find(g => g.key === 'sauce');
    assertEqual(sauceGroup?.minSelect, 1, 'sauce minSelect=1');
    assertEqual(sauceGroup?.maxSelect, 1, 'sauce maxSelect=1');
    assertEqual(groupKeys.length, 6, 'exactly 6 canonical groups');
    assertTrue(!groupKeys.includes('addons'), 'addons group removed');
    assertTrue(!groupKeys.includes('nuts'), 'nuts group removed');
    for (const ing of (salad?.ingredients || [])) {
      assertTrue(groupKeys.includes(ing.groupKey), `ingredient groupKey '${ing.groupKey}' exists in groups`);
      assertTrue(ing.groupKey !== 'addons', 'ingredient groupKey addons removed');
      assertTrue(ing.groupKey !== 'nuts', 'ingredient groupKey nuts removed');
    }
  });

  await test('builderCatalog sandwiches contain only real sandwich meals', async () => {
    const res = await makeRequest('GET', '/api/subscriptions/meal-planner-menu');
    const sandwiches = res.body.data?.builderCatalog?.sandwiches || [];
    assertTrue(sandwiches.some((item) => item.id === String(sandwichMeal._id)), 'seed sandwich present');
    assertTrue(!sandwiches.some((item) => item.id === String(nonSandwichMeal._id)), 'non-sandwich meal excluded');
  });

  await test('builderCatalog carbs exclude legacy large_salad pseudo-carb', async () => {
    const res = await makeRequest('GET', '/api/subscriptions/meal-planner-menu');
    const carbs = res.body.data?.builderCatalog?.carbs || [];
    assertTrue(!carbs.some((item) => item.displayCategoryKey === 'large_salad'), 'large_salad carb excluded');
  });

  console.log('\n--- A2) Builder Premium Meals ---\n');
  await test('GET /api/builder/premium-meals returns 4 items', async () => {
    const res = await makeRequest('GET', '/api/builder/premium-meals');
    assertEqual(res.status, 200, 'status');
    assertEqual(res.body.status, true, 'status');
    assertNoTopLevelOk(res.body, 'builder premium meals response');
    assertArray(res.body.data, 'data is array');
    assertEqual(res.body.data.length, 4, 'returns 4 items');
  });

  await test('premium-meals includes shrimp, beef_steak, salmon, custom_premium_salad', async () => {
    const res = await makeRequest('GET', '/api/builder/premium-meals');
    const items = res.body.data || [];
    const hasSalmon = items.some(i => (i.name || '').toLowerCase().includes('salmon'));
    const hasShrimp = items.some(i => (i.name || '').toLowerCase().includes('shrimp'));
    const hasBeef = items.some(i => (i.name || '').toLowerCase().includes('beef') || (i.name || '').toLowerCase().includes('steak'));
    const hasCustomSalad = items.some(i => i.id === 'custom_premium_salad');
    assertTrue(hasShrimp, 'shrimp present');
    assertTrue(hasBeef, 'beef_steak present');
    assertTrue(hasSalmon, 'salmon present');
    assertTrue(hasCustomSalad, 'custom_premium_salad present');
  });

  await test('legacy premium-meals catalog keeps custom_premium_salad compatibility shape', async () => {
    const res = await makeRequest('GET', '/api/builder/premium-meals');
    const items = res.body.data || [];
    const salad = items.find(i => i.premiumKey === 'custom_premium_salad' || i.id === 'custom_premium_salad');
    assertTrue(!!salad, 'custom_premium_salad found');
    assertEqual(salad.premiumKey, 'custom_premium_salad', 'premiumKey');
    assertEqual(salad.selectionType, 'custom_premium_salad', 'selectionType');
    assertEqual(salad.type, 'custom_premium_salad', 'type');
    assertEqual(salad.extraFeeHalala, 3000, 'extraFeeHalala');
    assertEqual(salad.ui.selectionStyle, 'builder', 'selectionStyle');
  });
  
  console.log('\n--- B) Day Load ---\n');
  await test('GET /days/:date returns 404 before save (day not created yet)', async () => {
    const res = await makeRequest('GET', `/api/subscriptions/${testSubscription._id}/days/${TEST_DATE}`);
    assertEqual(res.status, 404, 'status - day not created until first save');
  });
  
  await test('GET /days/:date returns 200 after save', async () => {
    const slots = [
      { slotIndex: 1, slotKey: 'slot_1', proteinId: String(standardProtein._id), carbs: [{ carbId: String(standardCarb._id), grams: 150 }], selectionType: 'standard_meal' },
      { slotIndex: 2, slotKey: 'slot_2', proteinId: String(standardProtein._id), carbs: [{ carbId: String(standardCarb._id), grams: 150 }], selectionType: 'standard_meal' },
    ];
    await makeRequest('PUT', `/api/subscriptions/${testSubscription._id}/days/${TEST_DATE}/selection`, { mealSlots: slots });
    const res = await makeRequest('GET', `/api/subscriptions/${testSubscription._id}/days/${TEST_DATE}`);
    assertEqual(res.status, 200, 'status');
    assertTrue(!!res.body.data, 'data');
    assertArray(res.body.data.mealSlots, 'mealSlots');
    const firstSlot = res.body.data.mealSlots[0] || {};
    assertArray(firstSlot.carbs, 'carbs array persisted');
    assertTrue(!Object.prototype.hasOwnProperty.call(firstSlot, 'carbId'), 'top-level carbId not exposed');
    assertTrue(!Object.prototype.hasOwnProperty.call(firstSlot, 'customSalad'), 'customSalad not exposed');
  });

  await test('GET /timeline returns canonical mealSlots without legacy slot fields', async () => {
    const res = await makeRequest('GET', `/api/subscriptions/${testSubscription._id}/timeline`);
    assertEqual(res.status, 200, 'status');
    const days = res.body.data?.days || [];
    const day = days.find((item) => item.date === TEST_DATE);
    assertTrue(!!day, 'saved day present in timeline');
    const firstSlot = (day.mealSlots || [])[0] || {};
    assertArray(firstSlot.carbs, 'timeline exposes carbs array');
    assertTrue(!Object.prototype.hasOwnProperty.call(firstSlot, 'carbId'), 'timeline does not expose top-level carbId');
    assertTrue(!Object.prototype.hasOwnProperty.call(firstSlot, 'customSalad'), 'timeline does not expose customSalad');
  });

  await test('PUT /days/selections/bulk accepts canonical mealSlots payload', async () => {
    const mealSlots = [
      { slotIndex: 1, slotKey: 'slot_1', proteinId: String(standardProtein._id), carbs: [{ carbId: String(standardCarb._id), grams: 150 }], selectionType: 'standard_meal' },
      { slotIndex: 2, slotKey: 'slot_2', proteinId: String(standardProtein._id), carbs: [{ carbId: String(standardCarb._id), grams: 150 }], selectionType: 'standard_meal' },
    ];
    const res = await makeRequest('PUT', `/api/subscriptions/${testSubscription._id}/days/selections/bulk`, {
      days: [
        { date: TEST_DATE_BULK1, mealSlots },
        { date: TEST_DATE_BULK2, mealSlots },
      ],
    });
    assertEqual(res.status, 200, 'status');
    assertEqual(res.body.data.summary.updatedCount, 2, 'two days updated');
    const day1 = await getActiveSubscriptionDay(TEST_DATE_BULK1);
    const day2 = await getActiveSubscriptionDay(TEST_DATE_BULK2);
    assertEqual((day1?.mealSlots || []).length, 2, 'bulk day 1 persisted');
    assertEqual((day2?.mealSlots || []).length, 2, 'bulk day 2 persisted');
  });

  await test('PUT /days/selections/bulk rejects legacy payloads without mealSlots', async () => {
    const res = await makeRequest('PUT', `/api/subscriptions/${testSubscription._id}/days/selections/bulk`, {
      dates: [TEST_DATE_BULK1],
      selections: [String(standardProtein._id)],
    });
    assertEqual(res.status, 200, 'status');
    assertEqual(res.body.data.summary.failedCount, 1, 'legacy payload failed');
    assertEqual(res.body.data.results[0].code, 'LEGACY_DAY_SELECTION_UNSUPPORTED', 'legacy bulk rejected explicitly');
  });
  
  console.log('\n--- C) Validate canonical standard meals ---\n');
  await test('POST /selection/validate returns valid', async () => {
    const slots = [
      { slotIndex: 1, slotKey: 'slot_1', proteinId: String(standardProtein._id), carbs: [{ carbId: String(standardCarb._id), grams: 150 }], selectionType: 'standard_meal' },
      { slotIndex: 2, slotKey: 'slot_2', proteinId: String(standardProtein._id), carbs: [{ carbId: String(standardCarb._id), grams: 150 }], selectionType: 'standard_meal' },
    ];
    const res = await makeRequest('POST', `/api/subscriptions/${testSubscription._id}/days/${TEST_DATE}/selection/validate`, { mealSlots: slots });
    assertEqual(res.status, 200, 'status');
  });
  
  console.log('\n--- D) Save canonical standard meals ---\n');
  await test('PUT /selection saves successfully (update existing day)', async () => {
    const slots = [
      { slotIndex: 1, slotKey: 'slot_1', proteinId: String(standardProtein._id), carbs: [{ carbId: String(standardCarb._id), grams: 150 }], selectionType: 'standard_meal' },
      { slotIndex: 2, slotKey: 'slot_2', proteinId: String(standardProtein._id), carbs: [{ carbId: String(standardCarb._id), grams: 150 }], selectionType: 'standard_meal' },
    ];
    const res = await makeRequest('PUT', `/api/subscriptions/${testSubscription._id}/days/${TEST_DATE}/selection`, { mealSlots: slots });
    assertEqual(res.status, 200, 'status');
  });
  
  await test('canonical standard meal slots persisted', async () => {
    const day = await getActiveSubscriptionDay(TEST_DATE);
    assertTrue(!!day, 'day exists');
    assertEqual(day?.mealSlots?.length, 2, 'two slots');
  });
  
  console.log('\n--- E) Sandwich Flow ---\n');
  await test('sandwich validates', async () => {
    const res = await makeRequest('POST', `/api/subscriptions/${testSubscription._id}/days/${TEST_DATE2}/selection/validate`, {
      mealSlots: [{ slotIndex: 1, slotKey: 'slot_1', sandwichId: String(sandwichMeal._id), selectionType: 'sandwich' }]
    });
    assertEqual(res.status, 200, 'status');
  });
  
  await test('sandwich save persists', async () => {
    const slots = [
      { slotIndex: 1, slotKey: 'slot_1', sandwichId: String(sandwichMeal._id), selectionType: 'sandwich' },
      { slotIndex: 2, slotKey: 'slot_2', proteinId: String(standardProtein._id), carbs: [{ carbId: String(standardCarb._id), grams: 150 }], selectionType: 'standard_meal' },
    ];
    const res = await makeRequest('PUT', `/api/subscriptions/${testSubscription._id}/days/${TEST_DATE2}/selection`, { mealSlots: slots });
    assertEqual(res.status, 200, 'status');
    const day = await getActiveSubscriptionDay(TEST_DATE2);
    const sandwichMaterialized = (day?.materializedMeals || []).filter(s => s.selectionType === 'sandwich');
    assertEqual(sandwichMaterialized.length, 1, 'sandwich in materializedMeals');
  });
  
  console.log('\n--- F) premium_large_salad with Balance ---\n');
  await test('premium_large_salad with shrimp uses balance', async () => {
    const sauceId = (await SaladIngredient.findOne({ groupKey: 'sauce' }))._id;
    const slots = [
      { slotIndex: 1, slotKey: 'slot_1', proteinId: String(premiumProteinShrimp._id), carbs: [{ carbId: String(standardCarb._id), grams: 150 }], selectionType: 'premium_meal' },
      { slotIndex: 2, slotKey: 'slot_2', selectionType: 'premium_large_salad', salad: { groups: { protein: [String(premiumProteinShrimp._id)], sauce: [String(sauceId)] } } },
    ];
    const res = await makeRequest('PUT', `/api/subscriptions/${testSubscription._id}/days/${TEST_DATE3}/selection`, { mealSlots: slots });
    assertEqual(res.status, 200, 'status');
    const day = await getActiveSubscriptionDay(TEST_DATE3);
    assertEqual((day?.premiumUpgradeSelections || []).length, 2, 'two premium selections persisted');
    const saladSelection = (day?.premiumUpgradeSelections || []).find((item) => item.baseSlotKey === 'slot_2');
    assertTrue(!!saladSelection, 'salad premium selection persisted');
    assertEqual(saladSelection?.premiumKey, CUSTOM_PREMIUM_SALAD_KEY, 'salad uses canonical premium key');
    assertEqual(saladSelection?.premiumSource, 'balance', 'salad used balance');
    const refreshedSub = await Subscription.findById(testSubscription._id).lean();
    const shrimpBalance = (refreshedSub?.premiumBalance || []).find((row) => row.premiumKey === 'shrimp');
    const saladBalance = (refreshedSub?.premiumBalance || []).find((row) => row.premiumKey === CUSTOM_PREMIUM_SALAD_KEY);
    assertEqual(Number(shrimpBalance?.remainingQty || 0), 1, 'shrimp balance decremented once for premium meal');
    assertEqual(Number(saladBalance?.remainingQty || 0), 0, 'salad entitlement decremented');
  });

  await test('editing away premium salad refunds premium entitlement consistently', async () => {
    const slots = [
      { slotIndex: 1, slotKey: 'slot_1', proteinId: String(standardProtein._id), carbs: [{ carbId: String(standardCarb._id), grams: 150 }], selectionType: 'standard_meal' },
      { slotIndex: 2, slotKey: 'slot_2', proteinId: String(standardProtein._id), carbs: [{ carbId: String(standardCarb._id), grams: 150 }], selectionType: 'standard_meal' },
    ];
    const res = await makeRequest('PUT', `/api/subscriptions/${testSubscription._id}/days/${TEST_DATE3}/selection`, { mealSlots: slots });
    assertEqual(res.status, 200, 'status');
    const day = await getActiveSubscriptionDay(TEST_DATE3);
    assertEqual((day?.premiumUpgradeSelections || []).length, 0, 'premium selections cleared after edit');
    const refreshedSub = await Subscription.findById(testSubscription._id).lean();
    const shrimpBalance = (refreshedSub?.premiumBalance || []).find((row) => row.premiumKey === 'shrimp');
    const saladBalance = (refreshedSub?.premiumBalance || []).find((row) => row.premiumKey === CUSTOM_PREMIUM_SALAD_KEY);
    assertEqual(Number(shrimpBalance?.remainingQty || 0), 2, 'shrimp balance refunded');
    assertEqual(Number(saladBalance?.remainingQty || 0), 1, 'salad entitlement refunded');
  });

  await test('addon helper endpoints are explicitly rejected in favor of canonical mealSlots', async () => {
    const addRes = await makeRequest('POST', `/api/subscriptions/${testSubscription._id}/addon-selections`, {
      date: TEST_DATE,
      addonId: String(addonJuice._id),
      qty: 1,
    });
    assertEqual(addRes.status, 422, 'add rejected');
    assertEqual(addRes.body.error?.code, 'LEGACY_ADDON_SELECTION_ENDPOINT_UNSUPPORTED', 'add code');

    const removeRes = await makeRequest('DELETE', `/api/subscriptions/${testSubscription._id}/addon-selections`, {
      date: TEST_DATE,
      addonId: String(addonJuice._id),
    });
    assertEqual(removeRes.status, 422, 'remove rejected');
    assertEqual(removeRes.body.error?.code, 'LEGACY_ADDON_SELECTION_ENDPOINT_UNSUPPORTED', 'remove code');
  });

  await test('premium helper endpoints are explicitly rejected in favor of canonical mealSlots', async () => {
    const createRes = await makeRequest('POST', `/api/subscriptions/${testSubscription._id}/premium-selections`, {
      date: TEST_DATE,
      baseSlotKey: 'slot_1',
      proteinId: String(premiumProteinShrimp._id),
    });
    assertEqual(createRes.status, 422, 'create rejected');
    assertEqual(createRes.body.error?.code, 'LEGACY_PREMIUM_SELECTION_ENDPOINT_UNSUPPORTED', 'create code');

    const removeRes = await makeRequest('DELETE', `/api/subscriptions/${testSubscription._id}/premium-selections`, {
      date: TEST_DATE,
      baseSlotKey: 'slot_1',
    });
    assertTrue(removeRes.status === 422 || removeRes.status === 400, 'remove helper no longer usable');
  });

  await test('planner allows entitled item addons and keeps item price independent from plan price', async () => {
    const slots = [
      { slotIndex: 1, slotKey: 'slot_1', proteinId: String(standardProtein._id), carbs: [{ carbId: String(standardCarb._id), grams: 150 }], selectionType: 'standard_meal' },
      { slotIndex: 2, slotKey: 'slot_2', proteinId: String(standardProtein._id), carbs: [{ carbId: String(standardCarb._id), grams: 150 }], selectionType: 'standard_meal' },
    ];
    const res = await makeRequest('PUT', `/api/subscriptions/${testSubscription._id}/days/${TEST_DATE4}/selection`, {
      mealSlots: slots,
      addonsOneTime: [String(addonJuice._id), String(addonJuice2._id)],
    });
    assertEqual(res.status, 200, 'status');
    const day = await getActiveSubscriptionDay(TEST_DATE4);
    assertEqual((day?.addonSelections || []).length, 2, 'two addon selections persisted');
    const first = (day?.addonSelections || []).find((item) => String(item.addonId) === String(addonJuice._id));
    const second = (day?.addonSelections || []).find((item) => String(item.addonId) === String(addonJuice2._id));
    assertEqual(first?.source, 'subscription', 'first entitled item covered by plan');
    assertEqual(Number(first?.priceHalala || 0), 0, 'covered item price is zero');
    assertEqual(second?.source, 'pending_payment', 'second item becomes paid overage');
    assertEqual(Number(second?.priceHalala || 0), Number(addonJuice2.priceHalala || 0), 'overage uses item price, not plan price');
  });

  await test('planner accepts non-entitled category items as paid overage using item price', async () => {
    const slots = [
      { slotIndex: 1, slotKey: 'slot_1', proteinId: String(standardProtein._id), carbs: [{ carbId: String(standardCarb._id), grams: 150 }], selectionType: 'standard_meal' },
      { slotIndex: 2, slotKey: 'slot_2', proteinId: String(standardProtein._id), carbs: [{ carbId: String(standardCarb._id), grams: 150 }], selectionType: 'standard_meal' },
    ];
    const res = await makeRequest('PUT', `/api/subscriptions/${testSubscription._id}/days/${TEST_DATE5}/selection`, {
      mealSlots: slots,
      addonsOneTime: [String(addonSmallSalad._id)],
    });
    assertEqual(res.status, 200, 'status');
    const day = await getActiveSubscriptionDay(TEST_DATE5);
    const selection = (day?.addonSelections || []).find((item) => String(item.addonId) === String(addonSmallSalad._id));
    assertTrue(!!selection, 'small salad selection persisted');
    assertEqual(selection?.source, 'pending_payment', 'non-entitled category is paid');
    assertEqual(Number(selection?.priceHalala || 0), Number(addonSmallSalad.priceHalala || 0), 'charged using item price');
  });

  await test('planner rejects plan add-ons directly', async () => {
    const slots = [
      { slotIndex: 1, slotKey: 'slot_1', proteinId: String(standardProtein._id), carbs: [{ carbId: String(standardCarb._id), grams: 150 }], selectionType: 'standard_meal' },
      { slotIndex: 2, slotKey: 'slot_2', proteinId: String(standardProtein._id), carbs: [{ carbId: String(standardCarb._id), grams: 150 }], selectionType: 'standard_meal' },
    ];
    const res = await makeRequest('PUT', `/api/subscriptions/${testSubscription._id}/days/${TEST_DATE5}/selection`, {
      mealSlots: slots,
      addonsOneTime: [String(addonJuicePlan._id)],
    });
    assertEqual(res.status, 400, 'status');
    assertEqual(res.body.error?.code, 'INVALID', 'plan add-on request rejected');
  });

  await test('planner accepts item selection with no add-on subscriptions as paid overage', async () => {
    const original = await Subscription.findById(testSubscription._id);
    const originalEntitlements = JSON.parse(JSON.stringify(original.addonSubscriptions || []));
    original.addonSubscriptions = [];
    await original.save();

    try {
      const slots = [
        { slotIndex: 1, slotKey: 'slot_1', proteinId: String(standardProtein._id), carbs: [{ carbId: String(standardCarb._id), grams: 150 }], selectionType: 'standard_meal' },
        { slotIndex: 2, slotKey: 'slot_2', proteinId: String(standardProtein._id), carbs: [{ carbId: String(standardCarb._id), grams: 150 }], selectionType: 'standard_meal' },
      ];
      const res = await makeRequest('PUT', `/api/subscriptions/${testSubscription._id}/days/${TEST_DATE7}/selection`, {
        mealSlots: slots,
        addonsOneTime: [String(addonJuice._id)],
      });
      assertEqual(res.status, 200, 'status');
      const day = await getActiveSubscriptionDay(TEST_DATE7);
      const selection = (day?.addonSelections || []).find((item) => String(item.addonId) === String(addonJuice._id));
      assertTrue(!!selection, 'juice selection persisted');
      assertEqual(selection?.source, 'pending_payment', 'no entitlement means paid');
      assertEqual(Number(selection?.priceHalala || 0), Number(addonJuice.priceHalala || 0), 'charged using item price');
    } finally {
      const restore = await Subscription.findById(testSubscription._id);
      restore.addonSubscriptions = originalEntitlements;
      await restore.save();
    }
  });

  await test('planner rejects inactive item add-ons', async () => {
    const slots = [
      { slotIndex: 1, slotKey: 'slot_1', proteinId: String(standardProtein._id), carbs: [{ carbId: String(standardCarb._id), grams: 150 }], selectionType: 'standard_meal' },
      { slotIndex: 2, slotKey: 'slot_2', proteinId: String(standardProtein._id), carbs: [{ carbId: String(standardCarb._id), grams: 150 }], selectionType: 'standard_meal' },
    ];
    const res = await makeRequest('PUT', `/api/subscriptions/${testSubscription._id}/days/${TEST_DATE7}/selection`, {
      mealSlots: slots,
      addonsOneTime: [String(addonInactive._id)],
    });
    assertEqual(res.status, 400, 'status');
    assertEqual(res.body.error?.code, 'INVALID', 'inactive item rejected');
  });

  await test('included entitlement resets per day', async () => {
    const slots = [
      { slotIndex: 1, slotKey: 'slot_1', proteinId: String(standardProtein._id), carbs: [{ carbId: String(standardCarb._id), grams: 150 }], selectionType: 'standard_meal' },
      { slotIndex: 2, slotKey: 'slot_2', proteinId: String(standardProtein._id), carbs: [{ carbId: String(standardCarb._id), grams: 150 }], selectionType: 'standard_meal' },
    ];
    const res = await makeRequest('PUT', `/api/subscriptions/${testSubscription._id}/days/${TEST_DATE8}/selection`, {
      mealSlots: slots,
      addonsOneTime: [String(addonJuice._id)],
    });
    assertEqual(res.status, 200, 'status');
    const day = await getActiveSubscriptionDay(TEST_DATE8);
    const selection = (day?.addonSelections || []).find((item) => String(item.addonId) === String(addonJuice._id));
    assertTrue(!!selection, 'juice selection persisted');
    assertEqual(selection?.source, 'subscription', 'first item on a new day is included again');
    assertEqual(Number(selection?.priceHalala || 0), 0, 'included price reset to zero on new day');
  });
  
  console.log('\n--- G) Current Overview ---\n');
  await test('GET /current/overview returns premiumSummary array', async () => {
    const res = await makeRequest('GET', '/api/subscriptions/current/overview');
    assertEqual(res.status, 200, 'status');
    assertEqual(res.body.status, true, 'status');
    assertNoTopLevelOk(res.body, 'current overview response');
    assertArray(res.body.data.premiumSummary, 'premiumSummary is array');
  });
  
  await test('premiumSummary has no duplicates', async () => {
    const res = await makeRequest('GET', '/api/subscriptions/current/overview');
    const summary = res.body.data.premiumSummary || [];
    const keys = summary.map(p => p.premiumKey).filter(Boolean);
    const uniqueKeys = new Set(keys);
    assertEqual(keys.length, uniqueKeys.size, 'no duplicates');
  });

  await test('premiumSummary has no premiumKey null rows', async () => {
    const res = await makeRequest('GET', '/api/subscriptions/current/overview');
    const summary = res.body.data.premiumSummary || [];
    const nullKeys = summary.filter(p => p.premiumKey === null || p.premiumKey === undefined || p.premiumKey === '');
    assertEqual(nullKeys.length, 0, 'no null premiumKey rows');
  });

  await test('premiumSummary contains only items with balance', async () => {
    const res = await makeRequest('GET', '/api/subscriptions/current/overview');
    const summary = res.body.data.premiumSummary || [];
    const keys = summary.map(p => p.premiumKey).filter(Boolean);
    const hasShrimp = keys.includes('shrimp');
    const hasBeefSteak = keys.includes('beef_steak');
    const hasSalmon = keys.includes('salmon');
    const hasCustomSalad = keys.includes('custom_premium_salad');
    
    assertTrue(hasShrimp, 'shrimp present (has balance)');
    assertTrue(hasBeefSteak, 'beef_steak present (has balance)');
    assertTrue(hasSalmon, 'salmon present (has balance)');
    assertTrue(hasCustomSalad, 'custom_premium_salad present (has balance)');
    
    // Ensure zero-quantity items are NOT present
    const zeroQtys = summary.filter(p => p.purchasedQtyTotal === 0 && p.remainingQtyTotal === 0 && p.consumedQtyTotal === 0);
    assertEqual(zeroQtys.length, 0, 'zero quantity items filtered out');
  });

  await test('premiumSummary preserves shrimp balance', async () => {
    const res = await makeRequest('GET', '/api/subscriptions/current/overview');
    const summary = res.body.data.premiumSummary || [];
    const shrimp = summary.find(p => p.premiumKey === 'shrimp');
    assertTrue(!!shrimp, 'shrimp in summary');
    assertEqual(shrimp?.purchasedQtyTotal, 2, 'shrimp purchasedQtyTotal 2');
    assertTrue(shrimp?.remainingQtyTotal >= 0, 'shrimp remainingQtyTotal >= 0');
  });

  await test('premiumSummary preserves beef steak balance', async () => {
    const res = await makeRequest('GET', '/api/subscriptions/current/overview');
    const summary = res.body.data.premiumSummary || [];
    const beefSteak = summary.find(p => p.premiumKey === 'beef_steak');
    assertTrue(!!beefSteak, 'beef_steak in summary');
    assertEqual(beefSteak?.purchasedQtyTotal, 1, 'beef_steak purchasedQtyTotal 1');
    assertEqual(beefSteak?.remainingQtyTotal, 1, 'beef_steak remainingQtyTotal 1');
  });

  await test('premiumSummary salmon has correct balance', async () => {
    const res = await makeRequest('GET', '/api/subscriptions/current/overview');
    const summary = res.body.data.premiumSummary || [];
    const salmon = summary.find(p => p.premiumKey === 'salmon');
    assertTrue(!!salmon, 'salmon in summary');
    assertEqual(salmon?.purchasedQtyTotal, 1, 'salmon purchasedQtyTotal 1');
    assertEqual(salmon?.remainingQtyTotal, 0, 'salmon remainingQtyTotal 0');
    assertEqual(salmon?.consumedQtyTotal, 1, 'salmon consumedQtyTotal 1');
  });
  
  await test('premiumSummary contains custom_premium_salad', async () => {
    const res = await makeRequest('GET', '/api/subscriptions/current/overview');
    const summary = res.body.data.premiumSummary || [];
    const salad = summary.find(p => p.premiumKey === CUSTOM_PREMIUM_SALAD_KEY);
    assertTrue(!!salad, 'custom_premium_salad present');
  });
  
  console.log('\n--- H) Date Range ---\n');
  await test('PUT /days/before-start rejected', async () => {
    const res = await makeRequest('PUT', `/api/subscriptions/${testSubscription._id}/days/${TEST_DATE_BEFORE}/selection`, { mealSlots: [] });
    assertTrue(res.status >= 400, 'error status');
  });
  
  console.log('\n--- I) Error Handling ---\n');
  await test('duplicate slotIndex returns 4xx', async () => {
    const res = await makeRequest('PUT', `/api/subscriptions/${testSubscription._id}/days/${TEST_DATE4}/selection`, {
      mealSlots: [
        { slotIndex: 1, slotKey: 'slot_1', proteinId: String(standardProtein._id), carbId: String(standardCarb._id) },
        { slotIndex: 1, slotKey: 'slot_2', proteinId: String(standardProtein._id), carbId: String(standardCarb._id) },
      ]
    });
    assertTrue(res.status >= 400, '4xx status');
  });

  console.log('\n--- K) Premium Protein Enforcement ---\n');
  await test('premium_meal rejects standard protein', async () => {
    const res = await makeRequest('POST', `/api/subscriptions/${testSubscription._id}/days/${TEST_DATE5}/selection/validate`, {
      mealSlots: [{ slotIndex: 1, proteinId: String(standardProtein._id), carbs: [{ carbId: String(standardCarb._id), grams: 150 }], selectionType: 'premium_meal' }]
    });
    assertEqual(res.status, 422, 'rejected with 422');
    assertEqual(res.body.error?.code, 'INVALID_PROTEIN_TYPE', 'error code');
  });

  await test('premium_large_salad rejects standard protein in protein group', async () => {
    const sauceId = (await SaladIngredient.findOne({ groupKey: 'sauce' }))._id;
    const res = await makeRequest('POST', `/api/subscriptions/${testSubscription._id}/days/${TEST_DATE5}/selection/validate`, {
      mealSlots: [{ 
        slotIndex: 1, 
        selectionType: 'premium_large_salad', 
        salad: { groups: { protein: [String(standardProtein._id)], sauce: [String(sauceId)] } } 
      }]
    });
    assertEqual(res.status, 422, 'rejected with 422');
    assertEqual(res.body.error?.code, 'SALAD_PROTEIN_NOT_PREMIUM', 'error code');
  });

  await test('standard_meal rejects unavailable protein', async () => {
    const res = await makeRequest('POST', `/api/subscriptions/${testSubscription._id}/days/${TEST_DATE5}/selection/validate`, {
      mealSlots: [{
        slotIndex: 1,
        selectionType: 'standard_meal',
        proteinId: String(unavailableProtein._id),
        carbs: [{ carbId: String(standardCarb._id), grams: 150 }],
      }],
    });
    assertEqual(res.status, 422, 'rejected with 422');
    assertEqual(res.body.error?.code, 'PROTEIN_REQUIRED', 'unavailable protein rejected');
  });

  await test('standard_meal rejects unavailable carb', async () => {
    const res = await makeRequest('POST', `/api/subscriptions/${testSubscription._id}/days/${TEST_DATE5}/selection/validate`, {
      mealSlots: [{
        slotIndex: 1,
        selectionType: 'standard_meal',
        proteinId: String(standardProtein._id),
        carbs: [{ carbId: String(unavailableCarb._id), grams: 150 }],
      }],
    });
    assertEqual(res.status, 422, 'rejected with 422');
    assertEqual(res.body.error?.code, 'INVALID_CARB_ID', 'unavailable carb rejected');
  });

  await test('premium_large_salad accepts premium protein in protein group', async () => {
    const sauceId = (await SaladIngredient.findOne({ groupKey: 'sauce' }))._id;
    const res = await makeRequest('POST', `/api/subscriptions/${testSubscription._id}/days/${TEST_DATE5}/selection/validate`, {
      mealSlots: [
        { 
          slotIndex: 1, 
          selectionType: 'premium_large_salad', 
          salad: { groups: { protein: [String(premiumProteinShrimp._id)], sauce: [String(sauceId)] } } 
        },
        {
          slotIndex: 2,
          selectionType: 'standard_meal',
          proteinId: String(standardProtein._id),
          carbs: [{ carbId: String(standardCarb._id), grams: 150 }]
        }
      ]
    });
    assertEqual(res.status, 200, 'accepted');
  });

  await test('confirm fails if stored slots violate real validators', async () => {
    const validSlots = [
      { slotIndex: 1, slotKey: 'slot_1', proteinId: String(standardProtein._id), carbs: [{ carbId: String(standardCarb._id), grams: 150 }], selectionType: 'standard_meal' },
      { slotIndex: 2, slotKey: 'slot_2', proteinId: String(standardProtein._id), carbs: [{ carbId: String(standardCarb._id), grams: 150 }], selectionType: 'standard_meal' },
    ];
    const saveRes = await makeRequest('PUT', `/api/subscriptions/${testSubscription._id}/days/${TEST_DATE6}/selection`, { mealSlots: validSlots });
    assertEqual(saveRes.status, 200, 'save status');

    const day = await getActiveSubscriptionDay(TEST_DATE6);
    const corruptedSlots = JSON.parse(JSON.stringify(day.mealSlots || []));
    corruptedSlots[0].selectionType = 'sandwich';
    corruptedSlots[0].sandwichId = String(sandwichMeal._id);
    await SubscriptionDay.updateOne({ _id: day._id }, { $set: { mealSlots: corruptedSlots } });

    const confirmRes = await makeRequest('POST', `/api/subscriptions/${testSubscription._id}/days/${TEST_DATE6}/confirm`);
    assertEqual(confirmRes.status, 422, 'confirm rejected');
    assertEqual(confirmRes.body.error?.code, 'SANDWICH_EXCLUSIVITY_VIOLATION', 'real validator error surfaced');
  });
  
  console.log('\n--- J) Idempotency ---\n');
  await test('repeated save does not duplicate meals', async () => {
    const slots = [
      { slotIndex: 1, slotKey: 'slot_1', proteinId: String(standardProtein._id), carbs: [{ carbId: String(standardCarb._id), grams: 150 }], selectionType: 'standard_meal' },
      { slotIndex: 2, slotKey: 'slot_2', proteinId: String(standardProtein._id), carbs: [{ carbId: String(standardCarb._id), grams: 150 }], selectionType: 'standard_meal' },
    ];
    await makeRequest('PUT', `/api/subscriptions/${testSubscription._id}/days/${TEST_DATE_IDEM}/selection`, { mealSlots: slots });
    await makeRequest('PUT', `/api/subscriptions/${testSubscription._id}/days/${TEST_DATE_IDEM}/selection`, { mealSlots: slots });
    const day = await getActiveSubscriptionDay(TEST_DATE_IDEM);
    assertEqual(day?.mealSlots?.length, 2, 'only 2 slots');
  });
  
  console.log('\n==========================================');
  console.log(`RESULTS: ${results.passed} passed, ${results.failed} failed, ${results.skipped} skipped`);
  console.log('==========================================\n');
  
  return results;
}

async function main() {
  // Check environment
  if (!isTestEnv && process.env.NODE_ENV !== 'test') {
    console.log('\n⚠️  WARNING: Integration tests should run with NODE_ENV=test');
  }
  
  // Check database name to prevent production DB usage (skip in CI/development)
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || '';
  const skipDbCheck = process.env.SKIP_DB_CHECK === 'true';
  if (!skipDbCheck && mongoUri.includes('basicdiet145') && !mongoUri.includes('_test')) {
    console.error('\n❌ ERROR: Integration tests must run against test database (_test suffix)');
    console.error('Current URI:', mongoUri);
    console.error('Set SKIP_DB_CHECK=true to bypass this check\n');
    process.exit(1);
  }
  
  try {
    console.log('Connecting to database...');
    await connectDatabase();
    console.log('Starting server...');
    await startServer();
    await wait(500);
    
    const results = await runTests();
    
    console.log('Cleaning up...');
    await stopServer();
    await cleanupTestData();
    await disconnectDatabase();
    
    console.log('\n--- Test Command ---');
    console.log('node tests/mealPlanner.integration.test.js');
    console.log('npm run test:integration\n');
    
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
