process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

require("../src/models/Addon");
const MenuCategory = require("../src/models/MenuCategory");
const MenuProduct = require("../src/models/MenuProduct");
const Plan = require("../src/models/Plan");
const Subscription = require("../src/models/Subscription");
const User = require("../src/models/User");
const {
  buildGenericAddonChoicesCatalog,
  buildSubscriptionAddonChoicesCatalog,
  resolveAddonChoiceProductById,
} = require("../src/services/subscription/subscriptionAddonChoicesService");
const {
  buildMenuProductsSnapshot,
  ERROR_CODE_BALANCE_BUCKET_MISMATCH,
  resolveOwnedAddonEntitlementChoice,
} = require("../src/services/subscription/subscriptionOwnedAddonSnapshotService");
const {
  reconcileAddonInclusions,
} = require("../src/services/subscription/subscriptionAddonAllocationService");
const {
  consumeAddonBalanceAtomically,
  releaseAddonBalanceAtomically,
} = require("../src/services/subscription/subscriptionSelectionService");
const {
  resolveAddonCategoryForMenuProduct,
} = require("../src/services/subscription/subscriptionAddonPolicyService");

let replSet;
let fixture;
let stepCount = 0;
let userSeq = 10;

function oid() {
  return new mongoose.Types.ObjectId();
}

async function step(name, fn) {
  stepCount += 1;
  await fn();
  console.log(`ok ${stepCount} - ${name}`);
}

async function resetDb() {
  await mongoose.connection.db.dropDatabase();
}

async function createCategory(key) {
  return MenuCategory.create({
    key,
    name: { en: key, ar: key },
    description: { en: `${key} description`, ar: `${key} description` },
    imageUrl: `https://cdn.example.test/${key}.jpg`,
    publishedAt: new Date(),
  });
}

async function createProduct(category, key, itemType, priceHalala = 1500, currency = "SAR") {
  return MenuProduct.create({
    categoryId: category._id,
    key,
    name: { en: key, ar: key },
    description: { en: `${key} description`, ar: `${key} description` },
    imageUrl: `https://cdn.example.test/${key}.jpg`,
    itemType,
    pricingModel: "fixed",
    priceHalala,
    currency,
    availableFor: ["one_time", "subscription"],
    publishedAt: new Date(),
  });
}

async function createBaseRows() {
  const user = await User.create({ phone: "+966500000001", name: "Owned Meal" });
  const otherUser = await User.create({ phone: "+966500000002", name: "Other User" });
  const plan = await Plan.create({
    key: "owned-meal-entitlement-plan",
    name: { en: "Owned Meal Entitlement Plan", ar: "Owned Meal Entitlement Plan" },
    daysCount: 5,
    durationDays: 5,
    gramsOptions: [{
      grams: 150,
      mealsOptions: [{ mealsPerDay: 1, priceHalala: 5000, compareAtHalala: 5000 }],
    }],
  });
  const categories = {
    meal: await createCategory("meals"),
    dessert: await createCategory("desserts"),
    snack: await createCategory("snacks"),
    small_salad: await createCategory("light_options"),
    juice: await createCategory("juice"),
  };
  const products = {
    meal: await createProduct(categories.meal, "owned_meal_box", "meal", 2100),
    dessert: await createProduct(categories.dessert, "owned_dessert_box", "dessert", 900),
    snack: await createProduct(categories.snack, "owned_snack_box", "snack", 800),
    small_salad: await createProduct(categories.small_salad, "greek_yogurt", "greek_yogurt", 700),
    juice: await createProduct(categories.juice, "owned_juice_box", "juice", 650),
  };
  const snapshots = {};
  for (const [key, product] of Object.entries(products)) {
    snapshots[key] = await buildMenuProductsSnapshot([product._id]);
    assert.strictEqual(snapshots[key].length, 1);
  }
  const planIds = {
    meal: oid(),
    dessert: oid(),
    snack: oid(),
    small_salad: oid(),
    juice: oid(),
    mealDuplicate: oid(),
  };
  return { user, otherUser, plan, categories, products, snapshots, planIds };
}

async function createSubscription(options = {}) {
  const {
    category = "meal",
    product = fixture.products.meal,
    planId = fixture.planIds.meal,
    remainingQty = 2,
    consumedQty = 0,
    unitPriceHalala = 2100,
    currency = "SAR",
    userId = null,
  } = options;
  const snapshot = Object.prototype.hasOwnProperty.call(options, "snapshot")
    ? options.snapshot
    : fixture.snapshots.meal;
  const ownerId = userId || (await User.create({
    phone: `+96650000${String(userSeq++).padStart(4, "0")}`,
    name: "Owned Meal Case",
  }))._id;
  return Subscription.create({
    userId: ownerId,
    planId: fixture.plan._id,
    status: "active",
    startDate: new Date(),
    endDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    totalMeals: 5,
    remainingMeals: 5,
    deliveryMode: "pickup",
    addonSubscriptions: [{
      addonId: planId,
      addonPlanId: planId,
      addonPlanName: `${category} entitlement`,
      category,
      maxPerDay: 1,
      quantityPerDay: 1,
      purchasedDailyQty: 1,
      includedTotalQty: remainingQty + consumedQty,
      unitPriceHalala,
      totalHalala: unitPriceHalala,
      currency,
      menuProductIds: [product._id],
      menuProductsSnapshot: snapshot,
    }],
    addonBalance: [{
      addonId: planId,
      addonPlanId: planId,
      name: `${category} entitlement`,
      category,
      includedTotalQty: remainingQty + consumedQty,
      purchasedQty: remainingQty + consumedQty,
      remainingQty,
      consumedQty,
      unitPriceHalala,
      currency,
    }],
  });
}

async function withSession(fn) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const result = await fn(session);
    await session.commitTransaction();
    return result;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}

function bucketOf(subscription) {
  return subscription.addonBalance[0];
}

async function run() {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: "owned-meal-entitlement-e2e" });
  await resetDb();
  fixture = await createBaseRows();

  await step("checkout snapshot stores full immutable product metadata", async () => {
    const snapshot = fixture.snapshots.meal[0];
    assert.ok(snapshot.id);
    assert.strictEqual(snapshot.key, "owned_meal_box");
    assert.deepStrictEqual(snapshot.name.en, "owned_meal_box");
    assert.deepStrictEqual(snapshot.description.en, "owned_meal_box description");
    assert.strictEqual(snapshot.categoryKey, "meals");
    assert.strictEqual(snapshot.itemType, "meal");
    assert.strictEqual(snapshot.priceHalala, 2100);
    assert.strictEqual(snapshot.currency, "SAR");
  });

  await step("owned catalog resolves from snapshot after live product is unpublished", async () => {
    const sub = await createSubscription();
    await MenuProduct.updateOne({ _id: fixture.products.meal._id }, {
      isActive: false,
      isVisible: false,
      isAvailable: false,
      publishedAt: null,
    });
    const catalog = await buildSubscriptionAddonChoicesCatalog({ subscriptionId: sub._id });
    assert.strictEqual(catalog.meal.choices.length, 1);
    assert.strictEqual(catalog.meal.choices[0].source, "subscription");
    assert.strictEqual(catalog.meal.choices[0].ownedSnapshot, true);
    assert.strictEqual(catalog.meal.choices[0].availableForNewSale, false);
    assert.strictEqual(catalog.meal.choices[0].unitPriceHalala, 2100);
    assert.strictEqual(String(catalog.meal.choices[0].balanceBucketId), String(bucketOf(sub)._id));
  });

  await step("owned resolver returns snapshot product while generic live resolver excludes it", async () => {
    const sub = await Subscription.findOne({ "addonSubscriptions.category": "meal" }).lean();
    const owned = await resolveAddonChoiceProductById(fixture.products.meal._id, { subscription: sub });
    const generic = await resolveAddonChoiceProductById(fixture.products.meal._id);
    assert.ok(owned);
    assert.strictEqual(owned.addonCategory, "meal");
    assert.strictEqual(owned.fromOwnedSnapshot, true);
    assert.strictEqual(generic, null);
  });

  await step("missing snapshot plus missing live product returns an unavailable owned placeholder", async () => {
    const product = await createProduct(fixture.categories.meal, "deleted_owned_meal", "meal", 2300);
    const sub = await createSubscription({ product, snapshot: undefined, planId: oid() });
    await MenuProduct.deleteOne({ _id: product._id });
    const catalog = await buildSubscriptionAddonChoicesCatalog({ subscriptionId: sub._id });
    const placeholder = catalog.meal.choices.find((choice) => choice.id === String(product._id));
    assert(placeholder);
    assert.strictEqual(placeholder.snapshotMissing, true);
    assert.strictEqual(placeholder.liveCatalogMissing, true);
    assert.strictEqual(placeholder.available, false);
    assert.strictEqual(placeholder.active, false);
    assert.strictEqual(placeholder.isEligibleForAllowance, true);
    assert.notStrictEqual(placeholder.pricingMode, "paid_no_entitlement");
  });

  await step("historical menuProductIds without snapshot can use archived live product", async () => {
    const product = await createProduct(fixture.categories.dessert, "archived_owned_dessert", "dessert", 1000);
    const sub = await createSubscription({
      category: "dessert",
      product,
      snapshot: undefined,
      planId: oid(),
      unitPriceHalala: 1000,
    });
    await MenuProduct.updateOne({ _id: product._id }, { isActive: false, publishedAt: null });
    const catalog = await buildSubscriptionAddonChoicesCatalog({ subscriptionId: sub._id, category: "dessert" });
    assert.strictEqual(catalog.dessert.choices.length, 1);
    assert.strictEqual(catalog.dessert.choices[0].id, String(product._id));
  });

  await step("meal category never maps to snack", async () => {
    assert.strictEqual(resolveAddonCategoryForMenuProduct({ itemType: "meal" }, "desserts"), "meal");
  });

  await step("dessert category remains dessert instead of snack when product says dessert", async () => {
    assert.strictEqual(resolveAddonCategoryForMenuProduct({ itemType: "dessert" }, "desserts"), "dessert");
  });

  await step("snack category remains snack", async () => {
    assert.strictEqual(resolveAddonCategoryForMenuProduct({ itemType: "snack" }, "snacks"), "snack");
  });

  await step("small_salad remains a supported backward-compatible generic category", async () => {
    const catalog = await buildGenericAddonChoicesCatalog({ category: "small_salad" });
    assert.ok(catalog.small_salad);
    assert.ok(catalog.small_salad.choices.some((row) => row.key === "greek_yogurt"));
  });

  await step("read-only allocation does not mutate balances", async () => {
    const sub = await createSubscription({ planId: oid() });
    const before = JSON.stringify(sub.addonBalance);
    const day = { addonSelections: [] };
    await reconcileAddonInclusions(sub.toObject(), day, [fixture.products.meal._id]);
    await reconcileAddonInclusions(sub.toObject(), day, [fixture.products.meal._id]);
    const after = await Subscription.findById(sub._id).lean();
    assert.strictEqual(JSON.stringify(after.addonBalance), before);
    assert.strictEqual(day.addonSelections[0].source, "subscription");
  });

  await step("allocation carries exact bucket identity", async () => {
    const sub = await createSubscription({ planId: oid() });
    const day = { addonSelections: [] };
    await reconcileAddonInclusions(sub.toObject(), day, [fixture.products.meal._id]);
    assert.strictEqual(String(day.addonSelections[0].balanceBucketId), String(bucketOf(sub)._id));
    assert.strictEqual(day.addonSelections[0].entitlementKey, `meal:${String(bucketOf(sub).addonPlanId)}`);
  });

  await step("consume then release restores the same bucket", async () => {
    const sub = await createSubscription({ planId: oid() });
    await withSession(async (session) => {
      const doc = await Subscription.findById(sub._id).session(session);
      const bucket = bucketOf(doc);
      const consumed = await consumeAddonBalanceAtomically({
        subscription: doc,
        addonId: fixture.products.meal._id,
        addonPlanId: bucket.addonPlanId,
        category: "meal",
        balanceBucketId: bucket._id,
        session,
      });
      assert.strictEqual(consumed.consumed, true);
      const released = await releaseAddonBalanceAtomically({
        subscription: doc,
        addonId: fixture.products.meal._id,
        addonPlanId: bucket.addonPlanId,
        category: "meal",
        unitPriceHalala: bucket.unitPriceHalala,
        currency: bucket.currency,
        balanceBucketId: bucket._id,
        session,
      });
      assert.strictEqual(released.released, true);
    });
    const fresh = await Subscription.findById(sub._id).lean();
    assert.strictEqual(fresh.addonBalance[0].remainingQty, 2);
    assert.strictEqual(fresh.addonBalance[0].consumedQty, 0);
  });

  await step("double release is idempotent and does not mint credits", async () => {
    const sub = await createSubscription({ planId: oid(), remainingQty: 2, consumedQty: 1 });
    await withSession(async (session) => {
      const doc = await Subscription.findById(sub._id).session(session);
      const bucket = bucketOf(doc);
      const first = await releaseAddonBalanceAtomically({
        subscription: doc,
        addonId: fixture.products.meal._id,
        addonPlanId: bucket.addonPlanId,
        category: "meal",
        unitPriceHalala: bucket.unitPriceHalala,
        currency: bucket.currency,
        balanceBucketId: bucket._id,
        session,
      });
      const second = await releaseAddonBalanceAtomically({
        subscription: doc,
        addonId: fixture.products.meal._id,
        addonPlanId: bucket.addonPlanId,
        category: "meal",
        unitPriceHalala: bucket.unitPriceHalala,
        currency: bucket.currency,
        balanceBucketId: bucket._id,
        session,
      });
      assert.strictEqual(first.released, true);
      assert.strictEqual(second.released, false);
      assert.strictEqual(second.reason, "no_consumed_balance");
    });
    const fresh = await Subscription.findById(sub._id).lean();
    assert.strictEqual(fresh.addonBalance[0].remainingQty, 3);
    assert.strictEqual(fresh.addonBalance[0].consumedQty, 0);
  });

  await step("stale subscription selection with consumedQty zero does not increment memory or database", async () => {
    const sub = await createSubscription({ planId: oid(), remainingQty: 2, consumedQty: 0 });
    await withSession(async (session) => {
      const doc = await Subscription.findById(sub._id).session(session);
      const bucket = bucketOf(doc);
      const result = await releaseAddonBalanceAtomically({
        subscription: doc,
        addonId: fixture.products.meal._id,
        addonPlanId: bucket.addonPlanId,
        category: "meal",
        unitPriceHalala: bucket.unitPriceHalala,
        currency: bucket.currency,
        balanceBucketId: bucket._id,
        session,
      });
      assert.strictEqual(result.released, false);
      assert.strictEqual(result.reason, "no_consumed_balance");
      assert.strictEqual(doc.addonBalance[0].remainingQty, 2);
    });
    const fresh = await Subscription.findById(sub._id).lean();
    assert.strictEqual(fresh.addonBalance[0].remainingQty, 2);
    assert.strictEqual(fresh.addonBalance[0].consumedQty, 0);
  });

  await step("wrong bucket id fails ownership resolution", async () => {
    const mealSub = await createSubscription({ planId: oid() });
    const juiceSub = await createSubscription({
      category: "juice",
      product: fixture.products.juice,
      snapshot: fixture.snapshots.juice,
      planId: oid(),
      unitPriceHalala: 650,
    });
    await assert.rejects(
      () => resolveOwnedAddonEntitlementChoice({
        subscription: mealSub.toObject(),
        productId: fixture.products.meal._id,
        addonPlanId: bucketOf(mealSub).addonPlanId,
        category: "meal",
        balanceBucketId: bucketOf(juiceSub)._id,
      }),
      (err) => err && err.code === ERROR_CODE_BALANCE_BUCKET_MISMATCH
    );
  });

  await step("wrong category cannot consume meal bucket", async () => {
    const sub = await createSubscription({ planId: oid() });
    await withSession(async (session) => {
      const doc = await Subscription.findById(sub._id).session(session);
      const bucket = bucketOf(doc);
      const result = await consumeAddonBalanceAtomically({
        subscription: doc,
        addonId: fixture.products.meal._id,
        addonPlanId: bucket.addonPlanId,
        category: "snack",
        balanceBucketId: bucket._id,
        session,
      });
      assert.strictEqual(result.consumed, false);
      assert.strictEqual(result.reason, "bucket_identity_mismatch");
    });
    const fresh = await Subscription.findById(sub._id).lean();
    assert.strictEqual(fresh.addonBalance[0].remainingQty, 2);
    assert.strictEqual(fresh.addonBalance[0].consumedQty, 0);
  });

  await step("wrong price cannot release or lose a consumed credit", async () => {
    const sub = await createSubscription({ planId: oid(), remainingQty: 1, consumedQty: 1 });
    await withSession(async (session) => {
      const doc = await Subscription.findById(sub._id).session(session);
      const bucket = bucketOf(doc);
      const result = await releaseAddonBalanceAtomically({
        subscription: doc,
        addonId: fixture.products.meal._id,
        addonPlanId: bucket.addonPlanId,
        category: "meal",
        unitPriceHalala: 9999,
        currency: bucket.currency,
        balanceBucketId: bucket._id,
        session,
      });
      assert.strictEqual(result.released, false);
      assert.strictEqual(result.reason, "bucket_identity_mismatch");
    });
    const fresh = await Subscription.findById(sub._id).lean();
    assert.strictEqual(fresh.addonBalance[0].remainingQty, 1);
    assert.strictEqual(fresh.addonBalance[0].consumedQty, 1);
  });

  await step("wrong currency cannot release or lose a consumed credit", async () => {
    const sub = await createSubscription({ planId: oid(), remainingQty: 1, consumedQty: 1 });
    await withSession(async (session) => {
      const doc = await Subscription.findById(sub._id).session(session);
      const bucket = bucketOf(doc);
      const result = await releaseAddonBalanceAtomically({
        subscription: doc,
        addonId: fixture.products.meal._id,
        addonPlanId: bucket.addonPlanId,
        category: "meal",
        unitPriceHalala: bucket.unitPriceHalala,
        currency: "USD",
        balanceBucketId: bucket._id,
        session,
      });
      assert.strictEqual(result.released, false);
      assert.strictEqual(result.reason, "bucket_identity_mismatch");
    });
    const fresh = await Subscription.findById(sub._id).lean();
    assert.strictEqual(fresh.addonBalance[0].remainingQty, 1);
    assert.strictEqual(fresh.addonBalance[0].consumedQty, 1);
  });

  await step("same product across plans resolves the requested addonPlanId", async () => {
    const sub = await createSubscription({ planId: fixture.planIds.meal, remainingQty: 1, consumedQty: 0 });
    sub.addonSubscriptions.push({
      addonId: fixture.planIds.mealDuplicate,
      addonPlanId: fixture.planIds.mealDuplicate,
      addonPlanName: "meal duplicate entitlement",
      category: "meal",
      maxPerDay: 1,
      quantityPerDay: 1,
      purchasedDailyQty: 1,
      includedTotalQty: 1,
      unitPriceHalala: 2100,
      totalHalala: 2100,
      currency: "SAR",
      menuProductIds: [fixture.products.meal._id],
      menuProductsSnapshot: fixture.snapshots.meal,
    });
    sub.addonBalance.push({
      addonId: fixture.planIds.mealDuplicate,
      addonPlanId: fixture.planIds.mealDuplicate,
      category: "meal",
      includedTotalQty: 1,
      purchasedQty: 1,
      remainingQty: 1,
      consumedQty: 0,
      unitPriceHalala: 2100,
      currency: "SAR",
    });
    await sub.save();
    const resolved = await resolveOwnedAddonEntitlementChoice({
      subscription: (await Subscription.findById(sub._id).lean()),
      productId: fixture.products.meal._id,
      addonPlanId: fixture.planIds.mealDuplicate,
      category: "meal",
    });
    assert.strictEqual(String(resolved.addonPlanId), String(fixture.planIds.mealDuplicate));
  });

  await step("same product across plans deterministically uses the first positive entitlement without a plan id", async () => {
    const sub = await Subscription.findOne({ "addonSubscriptions.addonPlanId": fixture.planIds.mealDuplicate }).lean();
    const resolved = await resolveOwnedAddonEntitlementChoice({
      subscription: sub,
      productId: fixture.products.meal._id,
      category: "meal",
    });
    assert.strictEqual(String(resolved.addonPlanId), String(fixture.planIds.meal));
  });

  await step("meal release does not alter snack or juice buckets", async () => {
    const sub = await createSubscription({ planId: oid(), remainingQty: 1, consumedQty: 1 });
    sub.addonSubscriptions.push({
      addonId: fixture.planIds.snack,
      addonPlanId: fixture.planIds.snack,
      category: "snack",
      includedTotalQty: 2,
      unitPriceHalala: 800,
      menuProductIds: [fixture.products.snack._id],
      menuProductsSnapshot: fixture.snapshots.snack,
    });
    sub.addonBalance.push({
      addonId: fixture.planIds.snack,
      addonPlanId: fixture.planIds.snack,
      category: "snack",
      includedTotalQty: 2,
      remainingQty: 2,
      consumedQty: 0,
      unitPriceHalala: 800,
      currency: "SAR",
    }, {
      addonId: fixture.planIds.juice,
      addonPlanId: fixture.planIds.juice,
      category: "juice",
      includedTotalQty: 4,
      remainingQty: 4,
      consumedQty: 0,
      unitPriceHalala: 650,
      currency: "SAR",
    });
    await sub.save();
    await withSession(async (session) => {
      const doc = await Subscription.findById(sub._id).session(session);
      const mealBucket = doc.addonBalance.find((row) => row.category === "meal");
      const result = await releaseAddonBalanceAtomically({
        subscription: doc,
        addonId: fixture.products.meal._id,
        addonPlanId: mealBucket.addonPlanId,
        category: "meal",
        unitPriceHalala: mealBucket.unitPriceHalala,
        currency: mealBucket.currency,
        balanceBucketId: mealBucket._id,
        session,
      });
      assert.strictEqual(result.released, true);
    });
    const fresh = await Subscription.findById(sub._id).lean();
    assert.deepStrictEqual(
      fresh.addonBalance.map((row) => `${row.category}:${row.remainingQty}:${row.consumedQty}`),
      ["meal:2:0", "snack:2:0", "juice:4:0"]
    );
  });

  await step("pending payment selection is not treated as subscription balance", async () => {
    const sub = await createSubscription({ planId: oid() });
    const day = { addonSelections: [{ addonId: fixture.products.meal._id, source: "pending_payment", category: "meal" }] };
    await reconcileAddonInclusions(sub.toObject(), day, [fixture.products.meal._id]);
    assert.strictEqual(day.addonSelections[0].source, "subscription");
    const fresh = await Subscription.findById(sub._id).lean();
    assert.strictEqual(fresh.addonBalance[0].remainingQty, 2);
  });

  await step("other user cannot resolve owned subscription catalog", async () => {
    const sub = await createSubscription({ planId: oid() });
    await assert.rejects(
      () => buildSubscriptionAddonChoicesCatalog({ subscriptionId: sub._id, userId: fixture.otherUser._id }),
      (err) => err && err.status === 403
    );
  });

  await step("no balance bucket remains retryable and does not mark success", async () => {
    const sub = await createSubscription({ planId: oid() });
    const bucket = bucketOf(sub);
    sub.addonBalance = [];
    const result = await withSession(async (session) => releaseAddonBalanceAtomically({
      subscription: sub,
      addonId: fixture.products.meal._id,
      addonPlanId: bucket.addonPlanId,
      category: "meal",
      unitPriceHalala: bucket.unitPriceHalala,
      currency: bucket.currency,
      balanceBucketId: bucket._id,
      session,
    }));
    assert.strictEqual(result.released, false);
    assert.strictEqual(result.reason, "bucket_not_found");
  });

  await step("exact product and plan identity outrank a stale category label", async () => {
    const sub = await createSubscription({ planId: oid() });
    const resolved = await resolveOwnedAddonEntitlementChoice({
      subscription: sub.toObject(),
      productId: fixture.products.meal._id,
      addonPlanId: bucketOf(sub).addonPlanId,
      category: "snack",
    });
    assert.strictEqual(String(resolved.productId), String(fixture.products.meal._id));
    assert.strictEqual(resolved.category, "meal");
  });

  await step("snapshot display payload includes the mobile/dashboard contract fields", async () => {
    const sub = await createSubscription({ planId: oid() });
    const catalog = await buildSubscriptionAddonChoicesCatalog({ subscriptionId: sub._id, category: "meal" });
    const choice = catalog.meal.choices[0];
    for (const key of [
      "id",
      "key",
      "name",
      "nameI18n",
      "description",
      "descriptionI18n",
      "imageUrl",
      "category",
      "categoryKey",
      "itemType",
      "priceHalala",
      "unitPriceHalala",
      "currency",
      "addonId",
      "addonPlanId",
      "addonPlanName",
      "entitlementKey",
      "entitlementCategory",
      "isEligibleForAllowance",
      "coveredQty",
      "paidQty",
      "payableTotalHalala",
      "source",
      "ownedSnapshot",
      "availableForNewSale",
      "balanceBucketId",
    ]) {
      assert.ok(Object.prototype.hasOwnProperty.call(choice, key), `missing ${key}`);
    }
  });

  assert.strictEqual(stepCount, 26);
  console.log("owned meal entitlement end-to-end tests passed");
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
    if (replSet) await replSet.stop().catch(() => {});
  });
