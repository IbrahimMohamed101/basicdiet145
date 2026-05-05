/**
 * One-Time Order Delivery Gate Tests
 * 
 * Tests the ONE_TIME_ORDER_DELIVERY_ENABLED feature gate that disables delivery for one-time orders
 * when the flag is false (default).
 */

require("dotenv").config();
const mongoose = require("mongoose");
const request = require("supertest");
const { createApp } = require("../src/app");

function describe(label, fn) {
  console.log(`\n📦 ${label}`);
  return fn();
}

function before(fn) {
  fn();
}

function after(fn) {
  fn();
}

async function connectDatabase() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/basicdiet_test");
  }
}

function it(name, fn) {
  return async function() {
    try {
      await fn();
      console.log(`✅ ${name}`);
    } catch (err) {
      console.error(`❌ ${name}`);
      console.error(err && err.stack ? err.stack : err);
    }
  };
}

const TEST_USER = {
  _id: new mongoose.Types.ObjectId(),
  phone: "966500000001",
  role: "client",
};

const BASE_ORDER = {
  items: [
    {
      itemType: "standard_meal",
      catalogRef: { model: "Meal", id: "507f1f77bcf86cd799439011" },
      qty: 1,
      selections: {
        proteinId: "507f1f77bcf86cd799439014",
        carbId: "507f1f77bcf86cd799439017",
      },
    },
  ],
  fulfillmentMethod: "pickup",
  pickup: {
    branchId: "main",
    pickupWindow: "12:00-13:00",
  },
};

const DELIVERY_ORDER = {
  ...BASE_ORDER,
  fulfillmentMethod: "delivery",
  delivery: {
    zoneId: "riyadh-zone-1",
    zoneName: "Riyadh Central",
    address: {
      label: "Home",
      line1: "123 Test Street",
      district: "Al Olaya",
      city: "Riyadh",
      phone: "966500000001",
    },
    deliveryWindow: "18:00-19:00",
  },
};

async function createTestUser() {
  const User = mongoose.model("User");
  const user = new User({
    _id: TEST_USER._id,
    phone: TEST_USER.phone,
    status: "active",
    role: "client",
  });
  await user.save();
  return user;
}

async function authenticateUser(agent) {
  const authResponse = await request(app)
    .post("/api/auth/login")
    .send({ phone: TEST_USER.phone });
  
  const token = authResponse.body.data?.token;
  if (token) {
    agent.set("Authorization", `Bearer ${token}`);
  }
  return token;
}

describe("One-Time Order Delivery Gate", function() {
  let agent;
  let authToken;

  before(async function() {
    await connectDatabase();
    await createTestUser();
    agent = request.agent(app);
    authToken = await authenticateUser(agent);
  });

  after(async function() {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
  });

  describe("When delivery is disabled (default)", function() {
    before(function() {
      // Ensure delivery is disabled (default)
      delete process.env.ONE_TIME_ORDER_DELIVERY_ENABLED;
    });

    it("should allow pickup order quote", async function() {
      const response = await agent
        .post("/api/orders/quote")
        .send(BASE_ORDER)
        .expect(200);

      response.body.should.have.property("status", true);
      response.body.data.should.have.property("pricing");
      response.body.data.pricing.should.have.property("deliveryFeeHalala", 0);
    });

    it("should allow pickup order creation", async function() {
      const response = await agent
        .post("/api/orders")
        .send(BASE_ORDER)
        .expect(200);

      response.body.should.have.property("status", true);
      response.body.data.should.have.property("orderId");
      response.body.data.should.have.property("paymentUrl");
    });

    it("should reject delivery order quote", async function() {
      const response = await agent
        .post("/api/orders/quote")
        .send(DELIVERY_ORDER)
        .expect(400);

      response.body.should.have.property("status", false);
      response.body.should.have.property("code", "DELIVERY_NOT_SUPPORTED");
      response.body.should.have.property("message", "Delivery is not currently supported for one-time orders");
    });

    it("should reject delivery order creation", async function() {
      const response = await agent
        .post("/api/orders")
        .send(DELIVERY_ORDER)
        .expect(400);

      response.body.should.have.property("status", false);
      response.body.should.have.property("code", "DELIVERY_NOT_SUPPORTED");
      response.body.should.have.property("message", "Delivery is not currently supported for one-time orders");
    });
  });

  describe("When delivery is enabled", function() {
    before(function() {
      // Enable delivery for testing
      process.env.ONE_TIME_ORDER_DELIVERY_ENABLED = "true";
    });

    after(function() {
      // Reset to default (disabled)
      delete process.env.ONE_TIME_ORDER_DELIVERY_ENABLED;
    });

    it("should allow delivery order quote when enabled", async function() {
      const response = await agent
        .post("/api/orders/quote")
        .send(DELIVERY_ORDER)
        .expect(200);

      response.body.should.have.property("status", true);
      response.body.data.should.have.property("pricing");
      response.body.data.pricing.should.have.property("deliveryFeeHalala").that.is.above(0);
    });

    it("should allow delivery order creation when enabled", async function() {
      const response = await agent
        .post("/api/orders")
        .send(DELIVERY_ORDER)
        .expect(200);

      response.body.should.have.property("status", true);
      response.body.data.should.have.property("orderId");
      response.body.data.should.have.property("paymentUrl");
    });

    it("should still allow pickup orders when delivery is enabled", async function() {
      const response = await agent
        .post("/api/orders")
        .send(BASE_ORDER)
        .expect(200);

      response.body.should.have.property("status", true);
      response.body.data.should.have.property("orderId");
    });
  });

  describe("Rate limiting", function() {
    it("should have rate limiting on quote endpoint", async function() {
      // Make multiple rapid requests to test rate limiting
      const promises = Array(10).fill().map(() =>
        agent
          .post("/api/orders/quote")
          .send(BASE_ORDER)
      );

      const responses = await Promise.allSettled(promises);
      const rateLimitedResponses = responses.filter(
        r => r.status === 'fulfilled' && r.value.status === 429
      );

      // At least some responses should be rate limited
      rateLimitedResponses.length.should.be.above(0);
    });

    it("should have rate limiting on verify payment endpoint", async function() {
      // Create an order first
      const orderResponse = await agent
        .post("/api/orders")
        .send(BASE_ORDER)
        .expect(200);

      const orderId = orderResponse.body.data.orderId;
      const paymentId = new mongoose.Types.ObjectId();

      // Make multiple rapid verification requests
      const promises = Array(10).fill().map(() =>
        agent
          .post(`/api/orders/${orderId}/payments/${paymentId}/verify`)
          .send({})
      );

      const responses = await Promise.allSettled(promises);
      const rateLimitedResponses = responses.filter(
        r => r.status === 'fulfilled' && r.value.status === 429
      );

      // At least some responses should be rate limited
      rateLimitedResponses.length.should.be.above(0);
    });
  });
});
