process.env.NODE_ENV = process.env.NODE_ENV || "test";

const assert = require("assert");
const mongoose = require("mongoose");

const {
  QuickDayDeductionError,
  createQuickDayDeductionService,
} = require("../src/services/dashboard/subscriptionQuickDayDeductionService");
const {
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
  await testSearchRolePolicy();
  await testDeductionServiceRolePolicy();
  console.log("subscriptionQuickDayDeductionRoles.test.js: OK");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
