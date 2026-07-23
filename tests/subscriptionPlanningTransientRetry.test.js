"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const {
  isTransientMongoTransactionError,
  retryDelayMs,
  runWithTransientTransactionRetry,
} = require("../src/services/installSubscriptionPlanningTransientRetry");

async function run() {
  assert.strictEqual(
    isTransientMongoTransactionError({
      errorLabels: ["TransientTransactionError"],
      message: "temporary transaction failure",
    }),
    true,
    "TransientTransactionError label is retryable"
  );

  assert.strictEqual(
    isTransientMongoTransactionError({
      code: 112,
      codeName: "WriteConflict",
      message: "Write conflict during plan update",
    }),
    true,
    "MongoDB WriteConflict is retryable"
  );

  assert.strictEqual(
    isTransientMongoTransactionError({
      message: "Unable to write due to catalog changes; please retry your operation or multi-document transaction.",
    }),
    true,
    "catalog-change transaction failure is retryable"
  );

  assert.strictEqual(
    isTransientMongoTransactionError({
      code: "SALAD_PROTEIN_NOT_ALLOWED",
      message: "Selected protein is not allowed",
    }),
    false,
    "business validation errors are not retried"
  );

  assert.strictEqual(retryDelayMs(1), 25);
  assert.strictEqual(retryDelayMs(2), 50);
  assert.strictEqual(retryDelayMs(5), 200);

  let attempts = 0;
  const sleeps = [];
  const result = await runWithTransientTransactionRetry(
    async () => {
      attempts += 1;
      if (attempts < 3) {
        const error = new Error("Please retry your operation or multi-document transaction");
        error.code = 112;
        throw error;
      }
      return { ok: true, attempts };
    },
    {
      operationName: "test_retry",
      maxAttempts: 3,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    }
  );

  assert.deepStrictEqual(result, { ok: true, attempts: 3 });
  assert.deepStrictEqual(sleeps, [25, 50]);

  attempts = 0;
  await assert.rejects(
    () => runWithTransientTransactionRetry(
      async () => {
        attempts += 1;
        const error = new Error("Invalid salad ingredient ID");
        error.code = "INVALID_SALAD_INGREDIENT";
        throw error;
      },
      {
        maxAttempts: 3,
        sleep: async () => {},
      }
    ),
    (error) => error.code === "INVALID_SALAD_INGREDIENT"
  );
  assert.strictEqual(attempts, 1, "non-transient errors fail immediately");

  console.log("subscriptionPlanningTransientRetry.test.js passed");
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
