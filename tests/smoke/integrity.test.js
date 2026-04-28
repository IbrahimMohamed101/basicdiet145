/**
 * Integrity & Response Contract Smoke Tests
 * 
 * Verifies:
 * - Unified API response envelope (ok: true)
 * - Plan viability filtering
 * - Health check endpoints
 * 
 * Run with: npm run smoke:integrity
 */

require('dotenv').config();

const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const http = require('http');

const { createApp } = require('../../src/app');
const User = require('../../src/models/User');
const Plan = require('../../src/models/Plan');

const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';
const BASE_URL = 'http://localhost:3000';

function issueAppAccessToken(userId) {
  return jwt.sign(
    { userId: String(userId), role: 'client', tokenType: 'app_access' },
    JWT_SECRET,
    { expiresIn: '31d' }
  );
}

let server = null;
let app = null;
let testUser = null;
let authToken = null;
let viablePlan = null;
let nonViablePlan = null;

const TEST_USER_PHONE = '+966501234888';

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

function assertEqual(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg || 'Assertion failed'}: expected ${expected}, got ${actual}`);
}

async function setup() {
  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/basicdiet_test';
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(mongoUri);
  }

  // Create test user
  testUser = await User.findOne({ phone: TEST_USER_PHONE });
  if (!testUser) {
    testUser = new User({ phone: TEST_USER_PHONE, name: 'Integrity Test User', role: 'client', isActive: true });
    await testUser.save();
  }
  authToken = issueAppAccessToken(testUser._id);

  // Setup Plans
  await Plan.deleteMany({ name: { $in: ['Viable Plan', 'Non-Viable Plan'] } });

  viablePlan = new Plan({
    name: { ar: 'Viable Plan', en: 'Viable Plan' },
    daysCount: 28,
    currency: 'SAR',
    isActive: true,
    gramsOptions: [{
      grams: 300,
      isActive: true,
      mealsOptions: [{ mealsPerDay: 2, priceHalala: 50000, compareAtHalala: 50000, isActive: true }]
    }]
  });
  await viablePlan.save();

  nonViablePlan = new Plan({
    name: { ar: 'Non-Viable Plan', en: 'Non-Viable Plan' },
    daysCount: 28,
    currency: 'SAR',
    isActive: true,
    gramsOptions: [{
      grams: 300,
      isActive: true,
      mealsOptions: [] // No meals
    }]
  });
  // Bypass validation if any? No, we use new Plan() then save().
  // Actually, we want to test if the controller filters it out even if it exists in DB.
  await mongoose.connection.collection('plans').insertOne(nonViablePlan.toObject());

  app = createApp();
  server = http.createServer(app);
  await new Promise(resolve => server.listen(3000, resolve));
}

async function teardown() {
  await Plan.deleteMany({ name: { $in: ['Viable Plan', 'Non-Viable Plan'] } });
  await User.deleteOne({ _id: testUser._id });
  if (server) await new Promise(resolve => server.close(resolve));
  await mongoose.disconnect();
}

async function runTests() {
  console.log('--- A) API Response Envelope Standards (ok: true) ---');
  
  const plansRes = await makeRequest('GET', '/api/plans');
  assertEqual(plansRes.status, 200, 'plans status');
  assertEqual(plansRes.body.ok, true, 'plans ok envelope');

  const overviewRes = await makeRequest('GET', '/api/subscriptions/current/overview');
  assertEqual(overviewRes.status, 200, 'overview status');
  assertEqual(overviewRes.body.ok, true, 'overview ok envelope');

  console.log('--- B) Plan Viability Filtering ---');

  const plans = plansRes.body.data || [];
  const names = plans.map(p => p.name);
  const hasViable = names.includes('Viable Plan');
  const hasNonViable = names.includes('Non-Viable Plan');
  
  if (!hasViable) throw new Error('Viable Plan missing from catalog');
  if (hasNonViable) throw new Error('Non-Viable Plan (missing meals) incorrectly present in catalog');
  console.log('✅ Non-viable plans correctly filtered out');

  console.log('--- C) Health Check Utility ---');
  const healthRes = await makeRequest('GET', '/api/health/catalog');
  assertEqual(healthRes.status, 200, 'health status');
  assertEqual(healthRes.body.ok, true, 'health ok envelope');
  
  const report = healthRes.body.data;
  const anomalies = report.anomalies || [];
  const nonViableAnomaly = anomalies.find(a => a.name.en === 'Non-Viable Plan');
  if (!nonViableAnomaly) throw new Error('Health check failed to detect non-viable plan');
  console.log('✅ Health check correctly detected non-viable plan');
}

(async () => {
  try {
    await setup();
    await runTests();
    console.log('\nSUCCESS: All integrity smoke tests passed.');
    await teardown();
    process.exit(0);
  } catch (err) {
    console.error('\nFAIL: Integrity smoke tests failed:', err.message);
    await teardown();
    process.exit(1);
  }
})();
