/**
 * Meal Planner Canonical Contract Verification
 * 
 * Verifies that the backend emits the exact canonical JSON structures expected by the Flutter frontend.
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
const SaladIngredient = require('../src/models/SaladIngredient');
const Meal = require('../src/models/Meal');
const MealCategory = require('../src/models/MealCategory');
const { ensureSafeForDestructiveOp } = require('../src/utils/dbSafety');

const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';
const PORT = 3055;
const BASE_URL = `http://localhost:${PORT}`;

function issueAppAccessToken(userId) {
  return jwt.sign(
    { userId: String(userId), role: 'client', tokenType: 'app_access' },
    JWT_SECRET,
    { expiresIn: '31d' }
  );
}

async function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };
    if (token) options.headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            body: data ? JSON.parse(data) : null,
          });
        } catch (e) {
          reject(new Error(`Failed to parse response: ${data}`));
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function assertEqual(actual, expected, msg, body = null) {
  if (actual !== expected) {
    console.error(`Assertion failed: ${msg}. Expected ${expected}, got ${actual}`);
    if (body) console.error('Response body:', JSON.stringify(body, null, 2));
    process.exit(1);
  }
}

function assertTrue(actual, msg) {
  if (actual !== true) {
    console.error(`Assertion failed: ${msg}. Expected true, got ${actual}`);
    process.exit(1);
  }
}

async function run() {
  console.log('--- Canonical Contract Verification ---');

  if (process.env.NODE_ENV !== 'test') {
    console.error('NODE_ENV must be "test"');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  await ensureSafeForDestructiveOp(mongoose.connection.db);

  // Clear existing
  await Promise.all([
    User.deleteMany({}),
    Subscription.deleteMany({}),
    SubscriptionDay.deleteMany({}),
    BuilderProtein.deleteMany({}),
    BuilderCarb.deleteMany({}),
    BuilderCategory.deleteMany({}),
    SaladIngredient.deleteMany({}),
    Meal.deleteMany({}),
    MealCategory.deleteMany({}),
  ]);

  // Seed minimum data
  const user = await User.create({ phone: '+966500000000', password: 'password' });
  const token = issueAppAccessToken(user._id);

  const catProtein = await BuilderCategory.create({ key: 'protein', dimension: 'protein', name: { ar: 'بروتين', en: 'Protein' }, isActive: true });
  const catCarb = await BuilderCategory.create({ key: 'standard_carbs', dimension: 'carb', name: { ar: 'كربوهيدرات', en: 'Standard Carbs' }, isActive: true });
  const catLargeSalad = await BuilderCategory.create({ key: 'large_salad', dimension: 'carb', name: { ar: 'سلطة كبيرة مميزة', en: 'Premium Large Salad' }, isActive: true });
  
  const standardProtein = await BuilderProtein.create({ name: { ar: 'دجاج', en: 'Chicken' }, isPremium: false, displayCategoryKey: 'chicken', displayCategoryId: catProtein._id, proteinFamilyKey: 'chicken', isActive: true });
  const premiumProtein = await BuilderProtein.create({ name: { ar: 'روبيان', en: 'Shrimp' }, isPremium: true, displayCategoryKey: 'premium', displayCategoryId: catProtein._id, proteinFamilyKey: 'seafood', premiumKey: 'shrimp', extraFeeHalala: 1500, isActive: true });
  const standardCarb = await BuilderCarb.create({ name: { ar: 'أرز', en: 'Rice' }, displayCategoryKey: 'standard_carbs', displayCategoryId: catCarb._id, isActive: true });
  const standardCarbLargeSalad = await BuilderCarb.create({ name: { ar: 'سلطة كبيرة', en: 'Large Salad' }, displayCategoryKey: 'large_salad', displayCategoryId: catLargeSalad._id, isActive: true });
  
  const sandwichCategory = await MealCategory.create({ key: 'sandwiches', name: { ar: 'سندوتشات', en: 'Sandwiches' }, isActive: true });
  const sandwich = await Meal.create({ name: { ar: 'ساندوتش دجاج', en: 'Chicken Sandwich' }, type: 'regular', categoryId: sandwichCategory._id, isActive: true });

  const app = createApp();
  const server = app.listen(PORT);

  try {
    // 1. Verify Menu
    console.log('Verifying Menu Catalog...');
    const menuRes = await request('GET', '/api/subscriptions/meal-planner-menu', null, token);
    assertEqual(menuRes.status, 200, 'Menu status', menuRes.body);
    assertTrue(menuRes.body.status, 'Menu status true');
    assertTrue(!!menuRes.body.data.builderCatalog, 'Missing builderCatalog');
    assertTrue(!!menuRes.body.data.builderCatalog.sandwiches, 'Missing sandwiches');
    assertTrue(!!menuRes.body.data.builderCatalog.premiumLargeSalad, 'Missing premiumLargeSalad');
    assertTrue(!!menuRes.body.data.addonCatalog, 'Missing addonCatalog');
    assertTrue(Array.isArray(menuRes.body.data.addonCatalog.items), 'addonCatalog.items should be array');

    // Create Subscription
    const sub = await Subscription.create({
      userId: user._id,
      status: 'active',
      planId: new mongoose.Types.ObjectId(), // dummy
      startDate: '2026-05-01',
      endDate: '2026-05-30',
      totalMeals: 90,
      remainingMeals: 90,
      selectedMealsPerDay: 3,
      deliveryMode: 'delivery',
      premiumBalance: [
        { proteinId: premiumProtein._id, premiumKey: 'shrimp', purchasedQty: 10, remainingQty: 10, name: 'Shrimp' }
      ]
    });

    const date = '2026-05-05';
    await SubscriptionDay.create({
      subscriptionId: sub._id,
      date,
      status: 'open',
      mealSlots: []
    });

    // 2. Verify Day Read (Baseline)
    console.log('Verifying Day Read...');
    const dayRes = await request('GET', `/api/subscriptions/${sub._id}/days/${date}`, null, token);
    assertEqual(dayRes.status, 200, 'Day read status');
    assertEqual(dayRes.body.data.paymentRequirement.blockingReason, 'PLANNING_INCOMPLETE', 'Initial blocking reason');

    // 3. Verify Validation & Save Canonical Shape
    console.log('Verifying Selection Save...');
    const selectionBody = {
      mealSlots: [
        {
          slotIndex: 1,
          selectionType: 'standard_meal',
          proteinId: standardProtein._id,
          carbs: [{ carbId: standardCarb._id, grams: 150 }]
        },
        {
            slotIndex: 2,
            selectionType: 'premium_meal',
            proteinId: premiumProtein._id,
            carbs: [{ carbId: standardCarb._id, grams: 150 }]
        },
        {
            slotIndex: 3,
            selectionType: 'sandwich',
            sandwichId: sandwich._id
        }
      ]
    };

    const saveRes = await request('PUT', `/api/subscriptions/${sub._id}/days/${date}/selection`, selectionBody, token);
    assertEqual(saveRes.status, 200, 'Save status');
    
    const savedDay = saveRes.body.data;
    assertEqual(savedDay.mealSlots[0].carbs[0].carbId, String(standardCarb._id), 'Check carbs array in slot 1');
    assertTrue(!savedDay.mealSlots[0].carbId, 'carbId should not be at top level');
    assertEqual(savedDay.mealSlots[2].sandwichId, String(sandwich._id), 'Check sandwichId in slot 3');

    // 4. Verify Payment Requirement Uppercase
    console.log('Verifying Payment Requirement...');
    await Subscription.updateOne({ _id: sub._id }, { $set: { premiumBalance: [] } });
    
    const reSaveRes = await request('PUT', `/api/subscriptions/${sub._id}/days/${date}/selection`, selectionBody, token);
    assertEqual(reSaveRes.body.data.paymentRequirement.blockingReason, 'PREMIUM_PAYMENT_REQUIRED', 'Check for PREMIUM_PAYMENT_REQUIRED', reSaveRes.body.data.paymentRequirement);


    // 5. Verify Validation Endpoint
    console.log('Verifying Selection Validation...');
    const validateRes = await request('POST', `/api/subscriptions/${sub._id}/days/${date}/selection/validate`, selectionBody, token);
    assertEqual(validateRes.status, 200, 'Validate status');
    assertTrue(validateRes.body.data.valid, 'Validation should be true');

    // 6. Verify Overview Aliases
    console.log('Verifying Overview Aliases...');
    await Subscription.updateOne({ _id: sub._id }, { $set: { premiumBalance: [
        { proteinId: premiumProtein._id, premiumKey: 'shrimp', purchasedQty: 10, remainingQty: 10, name: 'Shrimp' }
    ] } });
    const overviewRes = await request('GET', '/api/subscriptions/current/overview', null, token);
    assertEqual(overviewRes.status, 200, 'Overview status', overviewRes.body);
    assertTrue(Array.isArray(overviewRes.body.data.premiumSummary), 'Missing premiumSummary alias');
    assertTrue(Array.isArray(overviewRes.body.data.addonsSummary), 'Missing addonsSummary alias');
    assertEqual(overviewRes.body.data.premiumSummary[0].premiumKey, 'shrimp', 'Premium summary content', overviewRes.body.data);

    // 7. Verify Timeline Canonical mealSlots
    console.log('Verifying Timeline Canonical mealSlots...');
    const timelineRes = await request('GET', `/api/subscriptions/${sub._id}/timeline`, null, token);
    assertEqual(timelineRes.status, 200, 'Timeline status');
    const timelineDay = timelineRes.body.data.days.find(d => d.date === date);
    assertTrue(!!timelineDay, 'Timeline day found');
    assertTrue(Array.isArray(timelineDay.mealSlots[0].carbs), 'Timeline slot carbs should be array');

    // 8. Verify Day Confirmation
    console.log('Verifying Day Confirmation...');
    // We need to "refresh" the day selections since we restored the balance,
    // so that it's no longer marked as pending_payment.
    await request('PUT', `/api/subscriptions/${sub._id}/days/${date}/selection`, selectionBody, token);
    
    const confirmRes = await request('POST', `/api/subscriptions/${sub._id}/days/${date}/confirm`, null, token);
    assertEqual(confirmRes.status, 200, 'Confirm status', confirmRes.body);
    assertTrue(confirmRes.body.data && confirmRes.body.data.plannerState === 'confirmed', 'Planner state confirmed', confirmRes.body.data);

    console.log('\n--- ALL CANONICAL CONTRACT CHECKS PASSED ---');

  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  } finally {
    server.close();
    await mongoose.disconnect();
  }
}

run();
