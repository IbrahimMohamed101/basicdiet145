"use strict";

const assert = require("node:assert");
const {
  STACKING_DASHBOARD_MUTATION_CODE,
  createDashboardSubscriptionStackingWriteGuard,
} = require("../src/middleware/dashboardSubscriptionStackingWriteGuard");

const subscriptionId = "64f000000000000000000001";
const rolloutUserId = "64f000000000000000000002";

function responseCapture() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

async function invoke(req, overrides = {}) {
  let nextCalls = 0;
  let nextError = null;
  const res = responseCapture();
  const guard = createDashboardSubscriptionStackingWriteGuard({
    globallyEnabled: () => true,
    writeEnabledForUser: (userId) => String(userId) === rolloutUserId,
    findBatchOwner: async () => null,
    findActiveSubscriptionForUser: async () => null,
    ...overrides,
  });
  await guard(req, res, (error) => {
    nextCalls += 1;
    nextError = error || null;
  });
  return { res, nextCalls, nextError };
}

async function run() {
  {
    const result = await invoke({
      method: "POST",
      originalUrl: "/api/dashboard/subscriptions/quote",
      body: { userId: rolloutUserId },
    });
    assert.strictEqual(result.nextCalls, 1);
  }

  {
    const result = await invoke(
      {
        method: "POST",
        originalUrl: "/api/dashboard/subscriptions",
        body: { userId: rolloutUserId },
      },
      {
        findActiveSubscriptionForUser: async () => ({
          _id: subscriptionId,
          userId: rolloutUserId,
        }),
      }
    );
    assert.strictEqual(result.nextCalls, 0);
    assert.strictEqual(result.res.statusCode, 503);
    assert.strictEqual(
      result.res.payload.error.code,
      STACKING_DASHBOARD_MUTATION_CODE
    );
  }

  {
    const result = await invoke(
      {
        method: "POST",
        originalUrl: "/api/dashboard/subscriptions",
        body: { userId: rolloutUserId },
      },
      {
        globallyEnabled: () => false,
        writeEnabledForUser: () => false,
        findActiveSubscriptionForUser: async () => ({
          _id: subscriptionId,
          userId: rolloutUserId,
        }),
        findBatchOwner: async () => ({
          containerSubscriptionId: subscriptionId,
          userId: rolloutUserId,
        }),
      }
    );
    assert.strictEqual(result.nextCalls, 0);
    assert.strictEqual(result.res.statusCode, 503);
    assert.strictEqual(
      result.res.payload.error.code,
      STACKING_DASHBOARD_MUTATION_CODE
    );
  }

  {
    const result = await invoke(
      {
        method: "POST",
        originalUrl: "/api/dashboard/subscriptions",
        body: { userId: rolloutUserId },
      },
      {
        globallyEnabled: () => false,
        writeEnabledForUser: () => false,
        findActiveSubscriptionForUser: async () => ({
          _id: subscriptionId,
          userId: rolloutUserId,
        }),
        findBatchOwner: async () => null,
      }
    );
    assert.strictEqual(result.nextCalls, 1);
    assert.strictEqual(result.res.payload, null);
  }

  {
    const request = {
      method: "POST",
      originalUrl:
        `/api/dashboard/subscriptions/${subscriptionId}/manual-deduction`,
      body: {},
    };
    const batchOwner = async () => ({
      containerSubscriptionId: subscriptionId,
      userId: rolloutUserId,
    });
    for (const globallyEnabled of [true, false]) {
      const result = await invoke(request, {
        globallyEnabled: () => globallyEnabled,
        writeEnabledForUser: () => false,
        findBatchOwner: batchOwner,
      });
      assert.strictEqual(result.nextCalls, 0);
      assert.strictEqual(result.res.statusCode, 503);
      assert.strictEqual(
        result.res.payload.error.code,
        STACKING_DASHBOARD_MUTATION_CODE
      );
    }
  }

  {
    const result = await invoke({
      method: "POST",
      originalUrl:
        `/api/dashboard/subscriptions/${subscriptionId}/quick-day-deduction`,
      body: {
        batchId: "64f000000000000000000003",
        days: 2,
      },
    }, {
      findBatchOwner: async () => {
        throw new Error("integrated quick deduction must bypass the legacy write guard");
      },
    });
    assert.strictEqual(result.nextCalls, 1);
    assert.strictEqual(result.nextError, null);
    assert.strictEqual(result.res.payload, null);
  }

  {
    const result = await invoke({
      method: "POST",
      originalUrl:
        `/api/dashboard/subscriptions/${subscriptionId}/manual-deduction`,
      body: {},
    });
    assert.strictEqual(result.nextCalls, 1);
    assert.strictEqual(result.res.payload, null);
  }

  {
    const result = await invoke({
      method: "GET",
      originalUrl: `/api/dashboard/subscriptions/${subscriptionId}/audit`,
    }, {
      findBatchOwner: async () => {
        throw new Error("safe reads must not query the write guard");
      },
    });
    assert.strictEqual(result.nextCalls, 1);
    assert.strictEqual(result.nextError, null);
  }

  console.log("subscription stacking dashboard write guard tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
