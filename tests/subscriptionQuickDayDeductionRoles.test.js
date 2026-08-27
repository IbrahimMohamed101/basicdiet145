process.env.NODE_ENV = process.env.NODE_ENV || "test";

const assert = require("assert");
const mongoose = require("mongoose");
const Subscription = require("../src/models/Subscription");
const SubscriptionEntitlementBatch = require("../src/models/SubscriptionEntitlementBatch");
const User = require("../src/models/User");

const {
  QuickDayDeductionError,
  createQuickDayDeductionService,
} = require("../src/services/dashboard/subscriptionQuickDayDeductionService");
const {
  buildPhoneSearchCandidates,
  buildPhoneSearchPattern,
  QuickDayDeductionSearchError,
  search,
} = require("../src/services/dashboard/subscriptionQuickDayDeductionSearchService");

async function expectError(work, ErrorType, code) {
  try {
    await work();
    assert.fail(`Expected ${code}`);
  } catch (error) {
    assert(error instanceof ErrorType, `expected ${ErrorType.name}, got ${error && error.name}`);
    assert.strictEqual(error.code, code);
  }
}

async function testSearchRolePolicy() {
  for (const role of ["superadmin", "admin", "cashier", "restaurant"]) {
    await expectError(
      () => search({ q: "x", role }),
      QuickDayDeductionSearchError,
      "INVALID_SEARCH"
    );
  }

  for (const role of ["kitchen", "courier"]) {
    await expectError(
      () => search({ q: "valid-query", role }),
      QuickDayDeductionSearchError,
      "FORBIDDEN"
    );
  }
}

function testPhoneSearchNormalization() {
  const localCandidates = buildPhoneSearchCandidates("0556419884");
  assert(localCandidates.includes("0556419884"));
  assert(localCandidates.includes("+966556419884"));
  assert(buildPhoneSearchPattern("0556419884").test("+966556419884"));

  const e164Candidates = buildPhoneSearchCandidates("+966 55 641 9884");
  assert(e164Candidates.includes("+966556419884"));
  assert(e164Candidates.includes("0556419884"));
  assert(buildPhoneSearchPattern("+966 55 641 9884").test("0556419884"));
}

function resolvedQuery(rows) {
  return {
    select() { return this; },
    sort() { return this; },
    limit() { return this; },
    lean() { return Promise.resolve(rows); },
  };
}

async function testSearchIncludesPickupBatchInsideDeliveryContainer() {
  const userId = new mongoose.Types.ObjectId();
  const pickupParentId = new mongoose.Types.ObjectId();
  const mixedParentId = new mongoose.Types.ObjectId();
  let pickupBatchFilter = null;
  let subscriptionFilter = null;
  const originals = {
    userFind: User.find,
    subscriptionFind: Subscription.find,
    batchFind: SubscriptionEntitlementBatch.find,
  };

  try {
    User.find = () => resolvedQuery([{
      _id: userId,
      name: "Stacked Pickup Customer",
      phone: "+966500000000",
    }]);
    SubscriptionEntitlementBatch.find = (filter) => {
      pickupBatchFilter = filter;
      return resolvedQuery([{ containerSubscriptionId: mixedParentId }]);
    };
    Subscription.find = (filter) => {
      subscriptionFilter = filter;
      return resolvedQuery([
        {
          _id: pickupParentId,
          userId,
          status: "active",
          deliveryMode: "pickup",
          remainingMeals: 5,
          selectedMealsPerDay: 1,
        },
        {
          _id: mixedParentId,
          userId,
          status: "active",
          deliveryMode: "delivery",
          remainingMeals: 10,
          selectedMealsPerDay: 2,
        },
      ]);
    };

    const results = await search({ q: "+966500000000", role: "cashier" });
    assert.strictEqual(results.length, 2);
    assert.strictEqual(pickupBatchFilter["deliverySnapshot.mode"], "pickup");
    assert.deepStrictEqual(pickupBatchFilter.status.$in, ["active", "paid_scheduled"]);
    assert.strictEqual(
      String(subscriptionFilter.$or[1]._id.$in[0]),
      String(mixedParentId)
    );
  } finally {
    User.find = originals.userFind;
    Subscription.find = originals.subscriptionFind;
    SubscriptionEntitlementBatch.find = originals.batchFind;
  }
}

async function testDeductionServiceRolePolicy() {
  const service = createQuickDayDeductionService({
    async getBusinessDate() { return "2026-08-27"; },
    async findEligibleBatches() { return []; },
    async findPlans() { return []; },
  });
  const subscriptionId = new mongoose.Types.ObjectId();

  for (const role of ["superadmin", "admin", "cashier", "restaurant"]) {
    const result = await service.listOptions({ subscriptionId, role });
    assert.strictEqual(result.subscriptionId, String(subscriptionId));
    assert.deepStrictEqual(result.batches, []);
  }

  for (const role of ["kitchen", "courier"]) {
    await expectError(
      () => service.listOptions({ subscriptionId, role }),
      QuickDayDeductionError,
      "FORBIDDEN"
    );
  }
}

async function run() {
  testPhoneSearchNormalization();
  await testSearchIncludesPickupBatchInsideDeliveryContainer();
  await testSearchRolePolicy();
  await testDeductionServiceRolePolicy();
  console.log("subscriptionQuickDayDeductionRoles.test.js: OK");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
