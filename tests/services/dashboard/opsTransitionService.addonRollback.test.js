const mongoose = require("mongoose");
const SubscriptionDay = require("../../../src/models/SubscriptionDay");
const Subscription = require("../../../src/models/Subscription");
const { executeAction } = require("../../../src/services/dashboard/opsTransitionService");
const { runMongoTransactionWithRetry } = require("../../../src/services/mongoTransactionRetryService");

const { MongoMemoryServer } = require("mongodb-memory-server");

let mongoServer;

describe("Add-on Rollback via opsTransitionService", () => {
  let subId;
  let dayId;
  let addonBucketId;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  });

  beforeEach(async () => {
    // Setup fresh mock data for each test
    addonBucketId = new mongoose.Types.ObjectId();
    const sub = await Subscription.create({
      userId: new mongoose.Types.ObjectId(),
      planId: new mongoose.Types.ObjectId(),
      status: "active",
      remainingMeals: 5,
      totalMeals: 20,
      deliveryMode: "pickup",
      addonBalance: [
        {
          _id: addonBucketId,
          addonId: new mongoose.Types.ObjectId(),
          category: "juice",
          remainingQty: 5,
          consumedQty: 2
        }
      ],
      premiumBalance: [
        {
          premiumKey: "custom_premium_salad",
          remainingQty: 5,
          purchasedQty: 5
        }
      ]
    });
    subId = sub._id;

    const day = await SubscriptionDay.create({
      subscriptionId: subId,
      date: "2026-08-01",
      status: "open",
      addonSelections: [
        {
          addonId: sub.addonBalance[0].addonId,
          category: "juice",
          source: "subscription"
        },
        {
          addonId: new mongoose.Types.ObjectId(),
          category: "snack",
          source: "pending_payment"
        }
      ],
      premiumUpgradeSelections: [
        {
          premiumKey: "custom_premium_salad",
          premiumSource: "balance",
          proteinId: new mongoose.Types.ObjectId(),
          baseSlotKey: "meal_0_protein"
        }
      ]
    });
    dayId = day._id;
  });

  afterEach(async () => {
    await Subscription.deleteMany({ _id: subId });
    await SubscriptionDay.deleteMany({ _id: dayId });
  });

  it("should release addon balance when day is canceled", async () => {
    await executeAction("cancel", {
      entityId: dayId,
      entityType: "subscription",
      userId: new mongoose.Types.ObjectId(),
      role: "admin",
      payload: { reason: "test cancel" }
    });

    const day = await SubscriptionDay.findById(dayId);
    expect(day.status).toBe("canceled_at_branch");
    expect(day.addonCreditsReleased).toBe(true);
    expect(day.addonSelections[0].source).toBe("pending_payment");

    const sub = await Subscription.findById(subId);
    const bucket = sub.addonBalance.id(addonBucketId);
    expect(bucket.remainingQty).toBe(6); // increased by 1
    expect(bucket.consumedQty).toBe(1);  // decreased by 1

    expect(day.premiumCreditsReleased).toBe(true);
    expect(day.premiumUpgradeSelections[0].premiumSource).toBe("pending_payment");
    const premiumBucket = sub.premiumBalance.find(b => b.premiumKey === "custom_premium_salad");
    expect(premiumBucket.remainingQty).toBe(6); // increased by 1
  });

  it("should not double-release addon balance on idempotent cancel calls", async () => {
    await executeAction("cancel", {
      entityId: dayId,
      entityType: "subscription",
      userId: new mongoose.Types.ObjectId(),
      role: "admin",
      payload: { reason: "test cancel" }
    });

    // Call it again
    await executeAction("cancel", {
      entityId: dayId,
      entityType: "subscription",
      userId: new mongoose.Types.ObjectId(),
      role: "admin",
      payload: { reason: "test cancel 2" }
    });

    const sub = await Subscription.findById(subId);
    const bucket = sub.addonBalance.id(addonBucketId);
    expect(bucket.remainingQty).toBe(6); // still 6

    const premiumBucket = sub.premiumBalance.find(b => b.premiumKey === "custom_premium_salad");
    expect(premiumBucket.remainingQty).toBe(6); // still 6
  });

  it("should not release pending_payment addons", async () => {
    // Only the first addon (source="subscription") should be released.
    // The second one is pending_payment.
    await executeAction("cancel", {
      entityId: dayId,
      entityType: "subscription",
      userId: new mongoose.Types.ObjectId(),
      role: "admin",
      payload: { reason: "test cancel" }
    });

    // We can't directly check the pending_payment addon balance because it wasn't tracked,
    // but the transaction shouldn't error, and the first one should be released.
    const sub = await Subscription.findById(subId);
    const bucket = sub.addonBalance.id(addonBucketId);
    expect(bucket.remainingQty).toBe(6);
  });

  it("should attempt to reconsume addon balance upon reopen", async () => {
    // First, cancel the day to release addons
    await executeAction("cancel", {
      entityId: dayId,
      entityType: "subscription",
      userId: new mongoose.Types.ObjectId(),
      role: "admin",
      payload: { reason: "test cancel" }
    });

    let sub = await Subscription.findById(subId);
    let bucket = sub.addonBalance.id(addonBucketId);
    expect(bucket.remainingQty).toBe(6);

    // Now, reopen the day
    await executeAction("reopen", {
      entityId: dayId,
      entityType: "subscription",
      userId: new mongoose.Types.ObjectId(),
      role: "admin",
      payload: {}
    });

    const day = await SubscriptionDay.findById(dayId);
    expect(day.status).toBe("open");
    expect(day.addonCreditsReleased).toBe(false);
    expect(day.addonSelections[0].source).toBe("subscription");

    sub = await Subscription.findById(subId);
    bucket = sub.addonBalance.id(addonBucketId);
    expect(bucket.remainingQty).toBe(5); // Consumed again!

    expect(day.premiumCreditsReleased).toBe(false);
    expect(day.premiumUpgradeSelections[0].premiumSource).toBe("balance");
    const premiumBucket = sub.premiumBalance.find(b => b.premiumKey === "custom_premium_salad");
    expect(premiumBucket.remainingQty).toBe(5); // Consumed again!
  });

  it("should NOT release addon/premium balance on no_show and be idempotent", async () => {
    // Set day status to ready_for_pickup to allow valid transition to no_show
    await SubscriptionDay.updateOne({ _id: dayId }, { $set: { status: "ready_for_pickup" } });

    // Create a mock pickup request to satisfy assertBranchPickupRequestExists
    const SubscriptionPickupRequest = require("../../../src/models/SubscriptionPickupRequest");
    await SubscriptionPickupRequest.create({
      subscriptionId: subId,
      userId: new mongoose.Types.ObjectId(),
      dayId: dayId,
      status: "locked",
      mealCount: 1,
      creditsReserved: true,
      date: "2026-08-01",
      pickupDate: new Date("2026-08-01")
    });

    // Execute no_show
    await executeAction("no_show", {
      entityId: dayId,
      entityType: "subscription",
      userId: new mongoose.Types.ObjectId(),
      role: "admin",
      payload: { reason: "test no_show" }
    });

    let day = await SubscriptionDay.findById(dayId);
    expect(day.status).toBe("no_show");
    // Guards should remain false because they were NOT released
    expect(day.addonCreditsReleased).toBe(false);
    expect(day.premiumCreditsReleased).toBe(false);
    
    // Balance should still be exactly as it was (forfeited)
    let sub = await Subscription.findById(subId);
    let bucket = sub.addonBalance.id(addonBucketId);
    expect(bucket.remainingQty).toBe(5); 

    let premiumBucket = sub.premiumBalance.find(b => b.premiumKey === "custom_premium_salad");
    expect(premiumBucket.remainingQty).toBe(5);

    // Call it again to test idempotency
    await executeAction("no_show", {
      entityId: dayId,
      entityType: "subscription",
      userId: new mongoose.Types.ObjectId(),
      role: "admin",
      payload: { reason: "test no_show 2" }
    });

    day = await SubscriptionDay.findById(dayId);
    expect(day.addonCreditsReleased).toBe(false);
    expect(day.premiumCreditsReleased).toBe(false);
    
    sub = await Subscription.findById(subId);
    bucket = sub.addonBalance.id(addonBucketId);
    expect(bucket.remainingQty).toBe(5); // Still 5
  });
});
