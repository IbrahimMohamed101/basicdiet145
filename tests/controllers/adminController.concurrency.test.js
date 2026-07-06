const mongoose = require("mongoose");
const request = require("supertest");
const express = require("express");
const { MongoMemoryServer } = require("mongodb-memory-server");
const Subscription = require("../../src/models/Subscription");
const Addon = require("../../src/models/Addon");
const { logger } = require("../../src/utils/logger");

jest.mock("../../src/utils/log");
jest.mock("../../src/models/ActivityLog", () => ({ create: jest.fn(), find: jest.fn() }));
jest.mock("../../src/models/SubscriptionAuditLog", () => ({ create: jest.fn() }));

const adminController = require("../../src/controllers/adminController");

let mongoServer;
const app = express();
app.use(express.json());
// Mock route for updateSubscriptionBalancesAdmin
app.post("/admin/subscriptions/:id/balances", (req, res, next) => {
  req.user = { _id: new mongoose.Types.ObjectId(), role: "admin" };
  next();
}, adminController.updateSubscriptionBalancesAdmin);

describe("updateSubscriptionBalancesAdmin Concurrency", () => {
  let subId;
  let testAddonId;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  });

  beforeEach(async () => {
    const addon = await Addon.create({
      name_en: "Juice",
      name_ar: "عصير",
      category: "juice",
      price: 10,
    });
    testAddonId = addon._id;

    const sub = await Subscription.create({
      userId: new mongoose.Types.ObjectId(),
      planId: new mongoose.Types.ObjectId(),
      status: "active",
      totalMeals: 20,
      remainingMeals: 10,
      deliveryMode: "pickup",
      addonBalance: [
        {
          _id: new mongoose.Types.ObjectId(),
          addonId: testAddonId,
          category: "juice",
          remainingQty: 10,
          consumedQty: 0
        }
      ],
      premiumBalance: [
        {
          premiumKey: "custom_premium_salad",
          remainingQty: 10,
          purchasedQty: 10
        }
      ]
    });
    subId = sub._id;
  });

  afterEach(async () => {
    await Subscription.deleteMany({ _id: subId });
    await Addon.deleteMany({ _id: testAddonId });
  });

  it("should log a warning if a concurrent balance consumption occurs during full-array overwrite", async () => {
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {});

    const originalFindById = Subscription.findById;
    let callCount = 0;

    jest.spyOn(Subscription, "findById").mockImplementation(function (id) {
      callCount++;
      const query = originalFindById.apply(this, arguments);
      
      if (callCount === 2) {
        const mockQuery = {
          select: function() { return this; },
          lean: async function() {
            await Subscription.updateOne(
              { _id: id, "addonBalance.category": "juice" }, 
              { $inc: { "addonBalance.$.remainingQty": -2, "addonBalance.$.consumedQty": 2 } }
            );
            return await query.select("addonBalance premiumBalance").lean();
          }
        };
        return mockQuery;
      }
      return query;
    });

    const response = await request(app)
      .post(`/admin/subscriptions/${subId}/balances`)
      .send({
        reason: "Admin overwrite testing",
        addonBalance: [
          {
            _id: new mongoose.Types.ObjectId(),
            addonId: testAddonId,
            category: "juice",
            remainingQty: 15,
            consumedQty: 0
          }
        ]
      });

    if (response.status !== 200) console.log(response.body);
    expect(response.status).toBe(200);
    
    expect(warnSpy).toHaveBeenCalled();
    const warnArgs = warnSpy.mock.calls[0];
    expect(warnArgs[0]).toContain("updateSubscriptionBalancesAdmin RACE CONDITION");
    expect(warnArgs[1]).toMatchObject({
      beforeAddonConsumed: 0,
      currentAddonConsumed: 2
    });

    warnSpy.mockRestore();
    Subscription.findById.mockRestore();
  });
});
