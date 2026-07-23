"use strict";

const { logger } = require("../utils/logger");
const selectionService = require("./subscription/subscriptionSelectionService");

const TRANSIENT_TRANSACTION_CODES = new Set([
  112, // WriteConflict
  244, // TransientTransactionError
  251, // NoSuchTransaction
  263, // OperationNotSupportedInTransaction during catalog changes
]);
const TRANSIENT_TRANSACTION_LABELS = new Set([
  "TransientTransactionError",
  "UnknownTransactionCommitResult",
]);

let installed = false;

function errorLabelsOf(error) {
  if (!error) return [];
  if (Array.isArray(error.errorLabels)) return error.errorLabels;
  if (error.errorLabelSet && typeof error.errorLabelSet[Symbol.iterator] === "function") {
    return [...error.errorLabelSet];
  }
  return [];
}

function isTransientMongoTransactionError(error) {
  if (!error) return false;

  if (typeof error.hasErrorLabel === "function") {
    for (const label of TRANSIENT_TRANSACTION_LABELS) {
      if (error.hasErrorLabel(label)) return true;
    }
  }

  if (errorLabelsOf(error).some((label) => TRANSIENT_TRANSACTION_LABELS.has(label))) {
    return true;
  }

  if (TRANSIENT_TRANSACTION_CODES.has(Number(error.code))) return true;

  const codeName = String(error.codeName || "").trim();
  if (["WriteConflict", "NoSuchTransaction"].includes(codeName)) return true;

  const message = String(error.message || "");
  return /TransientTransactionError|UnknownTransactionCommitResult|WriteConflict|catalog changes|please retry (?:the )?(?:operation|transaction)|retry your operation or multi-document transaction/i.test(message);
}

function retryDelayMs(attempt) {
  return Math.min(200, 25 * (2 ** Math.max(0, attempt - 1)));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWithTransientTransactionRetry(operation, {
  operationName = "subscription_planning_transaction",
  context = {},
  maxAttempts = 3,
  sleep = wait,
} = {}) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation({ attempt });
    } catch (error) {
      lastError = error;
      const transient = isTransientMongoTransactionError(error);
      if (!transient || attempt >= maxAttempts) throw error;

      const delayMs = retryDelayMs(attempt);
      logger.warn("Retrying transient subscription planning transaction", {
        ...context,
        operation: operationName,
        attempt,
        nextAttempt: attempt + 1,
        maxAttempts,
        delayMs,
        code: error.code || null,
        codeName: error.codeName || null,
        error: error.message,
      });
      await sleep(delayMs);
    }
  }

  throw lastError;
}

function wrapSelectionOperation(name) {
  const original = selectionService[name];
  if (typeof original !== "function") {
    throw new Error(`subscriptionSelectionService.${name} is missing`);
  }

  selectionService[name] = async function retryableSubscriptionSelectionOperation(args = {}) {
    return runWithTransientTransactionRetry(
      () => original.call(selectionService, args),
      {
        operationName: name,
        context: {
          subscriptionId: args && args.subscriptionId ? String(args.subscriptionId) : null,
          date: args && args.date ? String(args.date) : null,
        },
      }
    );
  };
}

function installSubscriptionPlanningTransientRetry() {
  if (installed) return;
  installed = true;

  wrapSelectionOperation("performDaySelectionUpdate");
  wrapSelectionOperation("performDayPlanningConfirmation");
}

installSubscriptionPlanningTransientRetry();

module.exports = {
  TRANSIENT_TRANSACTION_CODES,
  TRANSIENT_TRANSACTION_LABELS,
  installSubscriptionPlanningTransientRetry,
  isTransientMongoTransactionError,
  retryDelayMs,
  runWithTransientTransactionRetry,
};
