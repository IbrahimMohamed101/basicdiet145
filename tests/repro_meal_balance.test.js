
require('dotenv').config();
const mongoose = require('mongoose');
const assert = require('assert');
const { createApp } = require('../src/app');
const http = require('http');
const jwt = require('jsonwebtoken');
const User = require('../src/models/User');
const Subscription = require('../src/models/Subscription');
const SubscriptionDay = require('../src/models/SubscriptionDay');
const Plan = require('../src/models/Plan');

const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';
const BASE_URL = 'http://localhost:3000';

function issueAppAccessToken(userId) {
  return jwt.sign(
    { userId: String(userId), role: 'client', tokenType: 'app_access' },
    JWT_SECRET,
    { expiresIn: '31d' }
  );
}

async function makeRequest(method, path, token, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: { 'Content-Type': 'application/json', 'Accept-Language': 'en' },
    };
    if (token) options.headers['Authorization'] = `Bearer ${token}`;
    
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

async function runRepro() {
  let server;
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/basicdiet_test');
    
    const app = createApp();
    server = http.createServer(app);
    await new Promise(resolve => server.listen(3000, resolve));

    // 1. Setup test data
    const user = await User.create({
      phone: '+966599999999',
      name: 'Repro User',
      role: 'client',
      isActive: true
    });
    const token = issueAppAccessToken(user._id);

    const plan = await Plan.create({
      name: { ar: 'خطة', en: 'Plan' },
      daysCount: 14,
      currency: 'SAR',
      isActive: true,
      gramsOptions: [{
        grams: 200,
        isActive: true,
        mealsOptions: [{ mealsPerDay: 1, priceHalala: 70000, compareAtHalala: 80000, isActive: true }],
      }],
    });

    const sub = await Subscription.create({
      userId: user._id,
      planId: plan._id,
      status: 'active',
      startDate: new Date('2026-04-01T00:00:00+03:00'),
      endDate: new Date('2026-04-14T00:00:00+03:00'),
      validityEndDate: new Date('2026-05-30T00:00:00+03:00'),
      totalMeals: 14,
      remainingMeals: 6,
      selectedGrams: 200,
      selectedMealsPerDay: 1,
      deliveryMode: 'pickup'
    });

    const testDate = '2026-04-05';
    await SubscriptionDay.create({
      subscriptionId: sub._id,
      date: testDate,
      status: 'open'
    });

    // 2. Test the endpoint
    console.log('Testing GET /api/subscriptions/:id/days/:date ...');
    const res = await makeRequest('GET', `/api/subscriptions/${sub._id}/days/${testDate}`, token);
    
    console.log('Status:', res.status);
    // console.log('Body:', JSON.stringify(res.body, null, 2));

    assert.strictEqual(res.status, 200);
    assert.ok(res.body.data, 'Response should have data');
    
    const dayData = res.body.data;
    console.log('Checking for mealBalance in response...');
    if (dayData.mealBalance) {
      console.log('✅ mealBalance found!');
      console.log(JSON.stringify(dayData.mealBalance, null, 2));
    } else {
      console.log('❌ mealBalance MISSING!');
    }

    // 3. Test Rule 8: remainingMeals = 0 -> canConsumeNow = false
    console.log('Testing Rule 8: remainingMeals = 0 ...');
    await Subscription.updateOne({ _id: sub._id }, { remainingMeals: 0 });
    const res2 = await makeRequest('GET', `/api/subscriptions/${sub._id}/days/${testDate}`, token);
    const balance2 = res2.body.data.mealBalance;
    console.log('remainingMeals:', balance2.remainingMeals);
    console.log('canConsumeNow:', balance2.canConsumeNow);
    assert.strictEqual(balance2.canConsumeNow, false, 'canConsumeNow should be false when remainingMeals is 0');
    assert.strictEqual(balance2.maxConsumableMealsNow, 0, 'maxConsumableMealsNow should be 0 when remainingMeals is 0');

    // Cleanup
    await SubscriptionDay.deleteMany({ subscriptionId: sub._id });
    await Subscription.deleteOne({ _id: sub._id });
    await Plan.deleteOne({ _id: plan._id });
    await User.deleteOne({ _id: user._id });

  } catch (err) {
    console.error('Test failed:', err);
  } finally {
    if (server) server.close();
    await mongoose.disconnect();
  }
}

runRepro();
