const mongoose = require("mongoose");

const { logger } = require("../utils/logger");

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 40;

function isRetryableMongoTransactionError(err) {
  if (!err) return false;

  if (typeof err.hasErrorLabel === "function") {
    if (err.hasErrorLabel("TransientTransactionError")) return true;
    if (err.hasErrorLabel("UnknownTransactionCommitResult")) return true;
  }

  const code = Number(err.code);
  if ([112, 244, 251].includes(code)) return true;

  const message = String(err.message || "").toLowerCase();
  return (
    message.includes("write conflict")
    || message.includes("transienttransactionerror")
    || message.includes("unknowntransactioncommitresult")
    || message.includes("temporarily unavailable")
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runMongoTransactionWithRetry(work, {
  label = "mongo_transaction",
  maxRetries = DEFAULT_MAX_RETRIES,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  context = {},
} = {}) {
  let attempt = 0;

  while (attempt <= maxRetries) {
    const session = await mongoose.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        result = await work(session, { attempt });
      });
      session.endSession();
      return result;
    } catch (err) {
      const retryable = isRetryableMongoTransactionError(err);
      logger.warn("Mongo transaction failed", {
        label,
        attempt: attempt + 1,
        maxRetries: maxRetries + 1,
        retryable,
        error: err.message,
        code: err.code || null,
        ...context,
      });
      session.endSession();

      if (!retryable || attempt >= maxRetries) {
        throw err;
      }

      const delayMs = baseDelayMs * Math.pow(2, attempt);
      await sleep(delayMs);
      attempt += 1;
    }
  }

  throw new Error(`Transaction retry loop exhausted for ${label}`);
}

module.exports = {
  isRetryableMongoTransactionError,
  runMongoTransactionWithRetry,
};
