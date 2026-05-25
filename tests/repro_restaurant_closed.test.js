"use strict";

require("dotenv").config();
const assert = require("assert");
const mongoose = require("mongoose");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const { createApp } = require("../src/app");
const Setting = require("../src/models/Setting");
const User = require("../src/models/User");
const { JWT_SECRET } = require("../src/middleware/auth");
const { resolveRestaurantOpenState } = require("../src/services/restaurantHoursService");

const { MongoMemoryServer } = require("mongodb-memory-server");

const TEST_TAG = `repro-restaurant-closed-${Date.now()}`;

let app;
let api;
let user;
let clientHeaders;
let mongod;

async function setup() {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri);

  app = createApp();
  api = request(app);

  user = await User.create({
    phone: "+966500000000",
    name: "Test User",
    role: "client",
    isActive: true,
  });

  const token = jwt.sign(
    { userId: String(user._id), role: "client", tokenType: "app_access" },
    JWT_SECRET
  );
  clientHeaders = { Authorization: `Bearer ${token}`, "Accept-Language": "en" };
}

async function teardown() {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
}

async function upsertSetting(key, value) {
  await Setting.updateOne({ key }, { $set: { value } }, { upsert: true });
}

async function runTests() {
  try {
    await setup();

    console.log("--- Test 1: Verify RESTAURANT_CLOSED when restaurant_is_open is false ---");
    await upsertSetting("restaurant_is_open", false);
    await upsertSetting("restaurant_open_time", "10:00");
    await upsertSetting("restaurant_close_time", "23:00");
    await upsertSetting("pickup_locations", [{ id: "main", isActive: true, name: "Main Branch" }]);

    const res1 = await api
      .post("/api/orders/quote")
      .set(clientHeaders)
      .send({
        fulfillmentMethod: "pickup",
        pickup: { branchId: "main", pickupWindow: "18:00-20:00" },
        items: [{ productId: new mongoose.Types.ObjectId(), qty: 1 }]
      });

    if (res1.status !== 409) {
      console.log("Response body:", JSON.stringify(res1.body, null, 2));
    }
    assert.strictEqual(res1.status, 409);
    assert.strictEqual(res1.body.error.code, "RESTAURANT_CLOSED");
    console.log("✅ Test 1 Success");

    console.log("--- Test 2: Verify RESTAURANT_CLOSED details includes hours ---");
    assert.strictEqual(res1.body.error.details.restaurantHours.openTime, "10:00");
    assert.strictEqual(res1.body.error.details.restaurantHours.closeTime, "23:00");
    console.log("✅ Test 2 Success");

    console.log("--- Test 3: Verify branchId 'openTime' behavior (currently ignored and replaced by 'main') ---");
    // Switch to open
    await upsertSetting("restaurant_is_open", true);
    
    // We need at least one valid product to test a successful quote, 
    // but the task is about validation order.
    // If we send invalid items, it should fail with EMPTY_ORDER first if we change the order.
    
    const res3 = await api
      .post("/api/orders/quote")
      .set(clientHeaders)
      .send({
        fulfillmentMethod: "pickup",
        pickup: { branchId: "openTime", pickupWindow: "18:00-20:00" },
        items: [{ productId: new mongoose.Types.ObjectId(), qty: 1 }]
      });

    // Now it fails with INVALID_BRANCH because we added validation
    assert.strictEqual(res3.body.error.code, "INVALID_BRANCH");
    console.log("✅ Test 3 Success");

    console.log("--- Test 4: Verify validation order (INVALID_BRANCH should be reported before RESTAURANT_CLOSED) ---");
    await upsertSetting("restaurant_is_open", false);
    const res4 = await api
      .post("/api/orders/quote")
      .set(clientHeaders)
      .send({
        fulfillmentMethod: "pickup",
        pickup: { branchId: "invalid-branch", pickupWindow: "18:00-20:00" },
        items: [{ productId: new mongoose.Types.ObjectId(), qty: 1 }]
      });
    
    assert.strictEqual(res4.status, 400);
    assert.strictEqual(res4.body.error.code, "INVALID_BRANCH");
    console.log("✅ Test 4 Success");

    console.log("--- Test 5: Verify valid branchId 'main' works (reaches item pricing) ---");
    await upsertSetting("restaurant_is_open", true);
    const res5 = await api
      .post("/api/orders/quote")
      .set(clientHeaders)
      .send({
        fulfillmentMethod: "pickup",
        pickup: { branchId: "main", pickupWindow: "18:00-20:00" },
        items: [{ productId: new mongoose.Types.ObjectId(), qty: 1 }]
      });
    
    // It should fail with ITEM_NOT_FOUND because the productId is random
    assert.strictEqual(res5.status, 404);
    assert.strictEqual(res5.body.error.code, "ITEM_NOT_FOUND");
    console.log("✅ Test 5 Success");

  } catch (err) {
    console.error("❌ Tests failed");
    console.error(err);
    process.exit(1);
  } finally {
    await teardown();
  }
}

runTests();
