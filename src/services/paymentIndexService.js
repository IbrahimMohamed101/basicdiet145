const mongoose = require("mongoose");
const Payment = require("../models/Payment");
const { logger } = require("../utils/logger");

const PAYMENT_INDEX_DEFINITIONS = [
  {
    name: "provider_1_providerInvoiceId_1",
    key: { provider: 1, providerInvoiceId: 1 },
    options: {
      name: "provider_1_providerInvoiceId_1",
      unique: true,
      partialFilterExpression: {
        providerInvoiceId: { $type: "string" },
      },
    },
  },
  {
    name: "provider_1_providerPaymentId_1",
    key: { provider: 1, providerPaymentId: 1 },
    options: {
      name: "provider_1_providerPaymentId_1",
      unique: true,
      partialFilterExpression: {
        providerPaymentId: { $type: "string" },
      },
    },
  },
];

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function indexNeedsRebuild(existingIndex, expected) {
  if (!existingIndex) return true;
  if (stableStringify(existingIndex.key || {}) !== stableStringify(expected.key)) {
    return true;
  }
  if (existingIndex.unique !== true) {
    return true;
  }
  if (stableStringify(existingIndex.partialFilterExpression || {}) !== stableStringify(expected.options.partialFilterExpression || {})) {
    return true;
  }
  return false;
}

async function normalizeStoredProviderIdentifiers(collection) {
  const invoiceCleanup = await collection.updateMany(
    { providerInvoiceId: { $in: [null, ""] } },
    { $unset: { providerInvoiceId: "" } }
  );
  const paymentCleanup = await collection.updateMany(
    { providerPaymentId: { $in: [null, ""] } },
    { $unset: { providerPaymentId: "" } }
  );

  logger.info("Normalized stored provider identifiers for payments", {
    providerInvoiceIdModified: Number(invoiceCleanup && invoiceCleanup.modifiedCount || 0),
    providerPaymentIdModified: Number(paymentCleanup && paymentCleanup.modifiedCount || 0),
  });
}

async function ensurePaymentIndexes() {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
    throw new Error("Mongo connection must be ready before ensuring payment indexes");
  }

  const collection = Payment.collection;
  await normalizeStoredProviderIdentifiers(collection);
  const existingIndexes = await collection.indexes();

  for (const definition of PAYMENT_INDEX_DEFINITIONS) {
    const existing = existingIndexes.find((index) => index.name === definition.name);
    if (!indexNeedsRebuild(existing, definition)) {
      continue;
    }

    if (existing) {
      await collection.dropIndex(definition.name);
      logger.warn("Dropped outdated payment index", { indexName: definition.name });
    }

    await collection.createIndex(definition.key, definition.options);
    logger.info("Ensured payment index", { indexName: definition.name });
  }
}

module.exports = {
  ensurePaymentIndexes,
};
