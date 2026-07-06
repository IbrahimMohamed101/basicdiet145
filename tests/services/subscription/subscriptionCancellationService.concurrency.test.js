const mongoose = require("mongoose");
const Subscription = require("../../../src/models/Subscription");
const SubscriptionDay = require("../../../src/models/SubscriptionDay");
const { cancelSubscriptionDomain } = require("../../../src/services/subscription/subscriptionCancellationService");
const { startSafeSession } = require("../../../src/utils/mongoTransactionSupport");
const { MongoMemoryServer } = require("mongodb-memory-server");

let mongoServer;

describe("Subscription Cancellation Concurrency", () => {
  let subId;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  });

  beforeEach(async () => {
    const sub = await Subscription.create({
      userId: new mongoose.Types.ObjectId(),
      planId: new mongoose.Types.ObjectId(),
      status: "active",
      deliveryMode: "pickup",
      remainingMeals: 10,
      totalMeals: 20,
    });
    subId = sub._id;
  });

  afterEach(async () => {
    await Subscription.deleteMany({ _id: subId });
    await SubscriptionDay.deleteMany({ subscriptionId: subId });
  });

  it("should calculate creditsToForfeit correctly and safely $inc to prevent lost updates", async () => {
    // We mock the runtime to simulate a concurrent update occurring exactly when 
    // findSubscriptionById returns, but before the final findOneAndUpdate.
    const mockRuntime = {
      startSession: async () => startSafeSession(),
      findSubscriptionById: async ({ subscriptionId }) => {
        const sub = await Subscription.findById(subscriptionId);
        
        // --- SIMULATE CONCURRENT CONSUMPTION HERE ---
        // Right after we read it in memory (remainingMeals = 10), a cron job consumes 2 meals.
        await Subscription.updateOne({ _id: subscriptionId }, { $inc: { remainingMeals: -2 } });
        // --- END SIMULATION ---
        
        return sub; // Memory still thinks it's 10
      },
      countUndeductedCommittedDays: async () => 0,
      findFutureOpenAndFrozenDays: async () => [],
      deleteFutureOpenAndFrozenDays: async () => ({ deletedCount: 0 }),
      resolveMealsPerDay: () => 1,
      getTodayKSADate: async () => new Date(),
      now: () => new Date(),
    };

    const result = await cancelSubscriptionDomain({
      subscriptionId: subId,
      actor: { kind: "admin" },
      runtime: mockRuntime
    });

    expect(result.outcome).toBe("canceled");
    // Memory thought remaining was 10, undeducted=0, preserved=0.
    // It forfeited 10.
    // Real DB was 8. So it will attempt to deduct 10, which will fail the $gte: 10 filter.
    // Since it failed, the fallback kicks in and just sets it to preservedCredits (0).
    // In either case, the DB should end up with 0 remainingMeals.
    
    const finalSub = await Subscription.findById(subId);
    expect(finalSub.remainingMeals).toBe(0);
    expect(finalSub.status).toBe("canceled");
  });

  it("should preserve concurrent deductions if there are preserved credits", async () => {
    // If the subscription had 10 meals, 5 committed days. Preserved = 5. Forfeit = 5.
    // Concurrent consumes 2 meals -> DB balance is 8.
    // Our $inc will do -5. DB balance becomes 8 - 5 = 3.
    // If we used the old $set: 5, we would clobber the -2 deduction.

    const mockRuntime = {
      startSession: async () => startSafeSession(),
      findSubscriptionById: async ({ subscriptionId }) => {
        const sub = await Subscription.findById(subscriptionId);
        // Simulate concurrent deduction of 2 meals.
        await Subscription.updateOne({ _id: subscriptionId }, { $inc: { remainingMeals: -2 } });
        return sub;
      },
      countUndeductedCommittedDays: async () => 5, // Preserves 5 meals
      findFutureOpenAndFrozenDays: async () => [],
      deleteFutureOpenAndFrozenDays: async () => ({ deletedCount: 0 }),
      resolveMealsPerDay: () => 1,
      getTodayKSADate: async () => new Date(),
      now: () => new Date(),
    };

    await cancelSubscriptionDomain({
      subscriptionId: subId,
      actor: { kind: "admin" },
      runtime: mockRuntime
    });

    const finalSub = await Subscription.findById(subId);
    // Preserved 5, but 2 were concurrently consumed, so the final actual should be 3!
    expect(finalSub.remainingMeals).toBe(3);
  });
});
