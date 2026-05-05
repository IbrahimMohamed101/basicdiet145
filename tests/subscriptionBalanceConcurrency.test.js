/**
 * Subscription Balance Concurrency Tests
 * 
 * Tests that meal balance deductions are atomic and audit logs contain
 * correct remainingMealsBefore/After values even under concurrent operations.
 */

require("dotenv").config();
const mongoose = require("mongoose");
const { consumeSubscriptionMealBalance } = require("../src/services/subscription/subscriptionDayConsumptionService");
const Subscription = require("../src/models/Subscription");
const SubscriptionAuditLog = require("../src/models/SubscriptionAuditLog");

function describe(label, fn) {
  console.log(`\n📦 ${label}`);
  return fn();
}

const TEST_USER_ID = new mongoose.Types.ObjectId();
const TEST_SUBSCRIPTION_ID = new mongoose.Types.ObjectId();

async function createTestSubscription(remainingMeals = 10) {
  const subscription = new Subscription({
    _id: TEST_SUBSCRIPTION_ID,
    userId: TEST_USER_ID,
    planId: new mongoose.Types.ObjectId(),
    status: "active",
    startDate: new Date(),
    endDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
    validityEndDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    totalMeals: 20,
    remainingMeals: remainingMeals,
  });
  await subscription.save();
  return subscription;
}

async function connectDatabase() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/basicdiet_test");
  }
}

function before(fn) {
  fn();
}

function before(fn) {
  fn();
}

function after(fn) {
  fn();
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

describe("Subscription Balance Concurrency", function() {
  let agent;
  let authToken;

  before(async function() {
    await connectDatabase();
    await createTestSubscription(10);
  });

  after(async function() {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
  });

  describe("Single consumption", function() {
    it("should deduct meals atomically and log correct values", async function() {
      const beforeSubscription = await Subscription.findById(TEST_SUBSCRIPTION_ID);
      const beforeMeals = beforeSubscription.remainingMeals;

      const result = await consumeSubscriptionMealBalance({
        subscriptionId: TEST_SUBSCRIPTION_ID,
        mealCount: 2,
        reason: "test_consumption",
      });

      const afterSubscription = await Subscription.findById(TEST_SUBSCRIPTION_ID);
      const afterMeals = afterSubscription.remainingMeals;

      // Verify atomic deduction
      result.should.have.property("deducted", true);
      result.should.have.property("mealCount", 2);
      result.should.have.property("remainingMealsBefore", beforeMeals);
      result.should.have.property("remainingMealsAfter", beforeMeals - 2);
      
      // Verify database state
      afterMeals.should.equal(beforeMeals - 2);

      // Verify audit log contains correct values
      const auditLog = await SubscriptionAuditLog.findOne({
        entityId: TEST_SUBSCRIPTION_ID,
        action: "cashier_manual_consumption",
      }).sort({ createdAt: -1 });

      auditLog.should.exist;
      auditLog.meta.should.have.property("mealCount", 2);
      auditLog.meta.should.have.property("remainingMealsBefore", beforeMeals);
      auditLog.meta.should.have.property("remainingMealsAfter", beforeMeals - 2);
    });

    it("should reject consumption with insufficient meals", async function() {
      const beforeSubscription = await Subscription.findById(TEST_SUBSCRIPTION_ID);
      const beforeMeals = beforeSubscription.remainingMeals;

      try {
        await consumeSubscriptionMealBalance({
          subscriptionId: TEST_SUBSCRIPTION_ID,
          mealCount: beforeMeals + 5, // More than available
          reason: "test_insufficient",
        });
        throw new Error("Should have thrown insufficient credits error");
      } catch (err) {
        err.code.should.equal("INSUFFICIENT_CREDITS");
      }

      // Verify no meals were deducted
      const afterSubscription = await Subscription.findById(TEST_SUBSCRIPTION_ID);
      afterSubscription.remainingMeals.should.equal(beforeMeals);

      // Verify no audit log was created for failed consumption
      const auditLog = await SubscriptionAuditLog.findOne({
        entityId: TEST_SUBSCRIPTION_ID,
        action: "cashier_manual_consumption",
        meta: { reason: "test_insufficient" },
      });
      should.not.exist(auditLog);
    });
  });

  describe("Concurrent consumption", function() {
    beforeEach(async function() {
      await cleanup();
      await createTestSubscription(10); // Reset to 10 meals before each test
    });

    it("should handle concurrent deductions safely", async function() {
      const beforeSubscription = await Subscription.findById(TEST_SUBSCRIPTION_ID);
      const beforeMeals = beforeSubscription.remainingMeals;

      // Make 3 concurrent requests for 3 meals each (total 9 meals)
      const concurrentRequests = Array(3).fill().map((_, index) =>
        consumeSubscriptionMealBalance({
          subscriptionId: TEST_SUBSCRIPTION_ID,
          mealCount: 3,
          reason: `concurrent_test_${index}`,
        })
      );

      const results = await Promise.allSettled(concurrentRequests);
      
      // Count successful and failed consumptions
      const successful = results.filter(r => r.status === 'fulfilled' && r.value.deducted);
      const failed = results.filter(r => r.status === 'rejected' && r.reason?.code === "INSUFFICIENT_CREDITS");

      // Should have 2 successful (6 meals) and 1 failed (insufficient for 3rd)
      successful.length.should.equal(2);
      failed.length.should.equal(1);

      // Verify final remaining meals (10 - 6 = 4)
      const finalSubscription = await Subscription.findById(TEST_SUBSCRIPTION_ID);
      finalSubscription.remainingMeals.should.equal(4);

      // Verify audit logs have correct remainingMealsAfter values
      const auditLogs = await SubscriptionAuditLog.find({
        entityId: TEST_SUBSCRIPTION_ID,
        action: "cashier_manual_consumption",
        "meta.reason": { $regex: /^concurrent_test_/ },
      }).sort({ createdAt: 1 });

      auditLogs.length.should.equal(2); // Only successful consumptions should be logged

      // Check that remainingMealsAfter values are correct and account for concurrent operations
      auditLogs.forEach((log, index) => {
        const expectedAfter = beforeMeals - ((index + 1) * 3); // 7, then 4
        log.meta.should.have.property("remainingMealsAfter", expectedAfter);
      });
    });

    it("should maintain audit consistency under high concurrency", async function() {
      const beforeSubscription = await Subscription.findById(TEST_SUBSCRIPTION_ID);
      const beforeMeals = beforeSubscription.remainingMeals;

      // Make 5 concurrent requests for 2 meals each (total 10 meals)
      const concurrentRequests = Array(5).fill().map((_, index) =>
        consumeSubscriptionMealBalance({
          subscriptionId: TEST_SUBSCRIPTION_ID,
          mealCount: 2,
          reason: `high_concurrency_test_${index}`,
        })
      );

      const results = await Promise.allSettled(concurrentRequests);
      
      // Count successful and failed consumptions
      const successful = results.filter(r => r.status === 'fulfilled' && r.value.deducted);
      const failed = results.filter(r => r.status === 'rejected' && r.reason?.code === "INSUFFICIENT_CREDITS");

      // Should have some successful and some failed due to race conditions
      successful.length.should.be.above(0);
      failed.length.should.be.above(0);
      successful.length.should.equal(5 - failed.length);

      // Verify final remaining meals are never negative
      const finalSubscription = await Subscription.findById(TEST_SUBSCRIPTION_ID);
      finalSubscription.remainingMeals.should.be.at.least(0);
      finalSubscription.remainingMeals.should.be.at.most(beforeMeals);

      // Verify all audit logs have valid remainingMealsAfter values
      const auditLogs = await SubscriptionAuditLog.find({
        entityId: TEST_SUBSCRIPTION_ID,
        action: "cashier_manual_consumption",
        "meta.reason": { $regex: /^high_concurrency_test_/ },
      }).sort({ createdAt: 1 });

      auditLogs.length.should.equal(successful.length);

      // All remainingMealsAfter values should be valid (non-negative and decreasing)
      auditLogs.forEach((log, index) => {
        const remainingAfter = log.meta.remainingMealsAfter;
        remainingAfter.should.be.at.least(0);
        remainingAfter.should.be.at.most(beforeMeals);
        
        if (index > 0) {
          const previousRemainingAfter = auditLogs[index - 1].meta.remainingMealsAfter;
          remainingAfter.should.be.at.most(previousRemainingAfter);
        }
      });
    });
  });

  describe("Edge cases", function() {
    it("should handle zero meal count gracefully", async function() {
      try {
        await consumeSubscriptionMealBalance({
          subscriptionId: TEST_SUBSCRIPTION_ID,
          mealCount: 0,
          reason: "test_zero",
        });
        throw new Error("Should have thrown invalid meal count error");
      } catch (err) {
        err.code.should.equal("INVALID_MEAL_COUNT");
      }
    });

    it("should handle negative meal count gracefully", async function() {
      try {
        await consumeSubscriptionMealBalance({
          subscriptionId: TEST_SUBSCRIPTION_ID,
          mealCount: -1,
          reason: "test_negative",
        });
        throw new Error("Should have thrown invalid meal count error");
      } catch (err) {
        err.code.should.equal("INVALID_MEAL_COUNT");
      }
    });

    it("should handle non-existent subscription", async function() {
      try {
        await consumeSubscriptionMealBalance({
          subscriptionId: new mongoose.Types.ObjectId(),
          mealCount: 1,
          reason: "test_nonexistent",
        });
        throw new Error("Should have thrown subscription not found error");
      } catch (err) {
        err.code.should.equal("SUBSCRIPTION_NOT_FOUND");
      }
    });
  });
});
