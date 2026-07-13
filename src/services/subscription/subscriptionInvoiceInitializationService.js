"use strict";

const crypto = require("crypto");
const mongoose = require("mongoose");
const CheckoutDraft = require("../../models/CheckoutDraft");
const { createInvoice: createProviderInvoice } = require("../moyasarService");
const { logger } = require("../../utils/logger");

const DEFAULT_STALE_CLAIM_MS = 2 * 60 * 1000;
const DEFAULT_WAIT_TIMEOUT_MS = 30 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 50;

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getInvoiceId(invoice) {
  return String(invoice && (invoice.id || invoice.invoice_id || invoice.invoiceId) || "").trim();
}

function getInvoiceUrl(invoice) {
  return String(invoice && (invoice.url || invoice.payment_url || invoice.paymentUrl) || "").trim();
}

function buildPersistedInvoiceResponse(draft, payload) {
  return {
    id: String(draft.providerInvoiceId),
    url: String(draft.paymentUrl),
    amount: Number(payload.amount || draft.breakdown?.totalHalala || 0),
    currency: String(payload.currency || draft.breakdown?.currency || "SAR"),
    status: "initiated",
    metadata: payload.metadata || {},
    reused: true,
  };
}

function buildInitializationError(code, message, status = 409) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

async function claimInvoiceInitialization({ draftId, staleClaimMs, now = new Date() }) {
  const token = crypto.randomUUID();
  const staleBefore = new Date(now.getTime() - staleClaimMs);

  const draft = await CheckoutDraft.findOneAndUpdate(
    {
      _id: draftId,
      status: "pending_payment",
      $and: [
        {
          $or: [
            { providerInvoiceId: { $exists: false } },
            { providerInvoiceId: null },
            { providerInvoiceId: "" },
          ],
        },
        {
          $or: [
            { "invoiceInitialization.status": { $exists: false } },
            { "invoiceInitialization.status": { $in: ["idle", "failed"] } },
            { "invoiceInitialization.startedAt": null },
            { "invoiceInitialization.startedAt": { $lte: staleBefore } },
          ],
        },
      ],
    },
    {
      $set: {
        "invoiceInitialization.status": "initializing",
        "invoiceInitialization.token": token,
        "invoiceInitialization.startedAt": now,
        "invoiceInitialization.completedAt": null,
        "invoiceInitialization.lastError": "",
      },
    },
    { new: true }
  );

  return draft ? { draft, token } : null;
}

async function initializeClaimedInvoice({
  claim,
  payload,
  createInvoiceFn,
}) {
  const { draft, token } = claim;

  try {
    const invoice = await createInvoiceFn(payload);
    const providerInvoiceId = getInvoiceId(invoice);
    const paymentUrl = getInvoiceUrl(invoice);

    if (!providerInvoiceId || !paymentUrl) {
      throw buildInitializationError(
        "PAYMENT_PROVIDER_INVALID_RESPONSE",
        "Invoice response missing required payment fields",
        502
      );
    }

    const persisted = await CheckoutDraft.updateOne(
      {
        _id: draft._id,
        "invoiceInitialization.token": token,
        "invoiceInitialization.status": "initializing",
      },
      {
        $set: {
          providerInvoiceId,
          paymentUrl,
          "invoiceInitialization.status": "ready",
          "invoiceInitialization.token": "",
          "invoiceInitialization.completedAt": new Date(),
          "invoiceInitialization.lastError": "",
        },
      }
    );

    if (persisted.modifiedCount !== 1) {
      const latest = await CheckoutDraft.findById(draft._id).lean();
      if (latest && latest.providerInvoiceId && latest.paymentUrl) {
        return buildPersistedInvoiceResponse(latest, payload);
      }
      throw buildInitializationError(
        "INVOICE_INITIALIZATION_CLAIM_LOST",
        "Checkout invoice initialization claim was lost"
      );
    }

    return invoice;
  } catch (err) {
    const safeFailureCode = String(err && (err.code || err.name) || "provider_error").slice(0, 120);
    await CheckoutDraft.updateOne(
      {
        _id: draft._id,
        "invoiceInitialization.token": token,
      },
      {
        $set: {
          "invoiceInitialization.status": "failed",
          "invoiceInitialization.token": "",
          "invoiceInitialization.completedAt": new Date(),
          "invoiceInitialization.lastError": safeFailureCode,
        },
      }
    ).catch((persistErr) => {
      logger.error("Failed to release subscription invoice initialization claim", {
        draftId: String(draft._id),
        error: persistErr.message,
      });
    });
    throw err;
  }
}

async function createSubscriptionCheckoutInvoice(payload, options = {}) {
  const draftId = String(payload && payload.metadata && payload.metadata.draftId || "").trim();
  const createInvoiceFn = options.createInvoiceFn || createProviderInvoice;

  // Keep this wrapper safe for any unexpected non-checkout caller.
  if (!draftId) {
    return createInvoiceFn(payload);
  }
  if (!mongoose.Types.ObjectId.isValid(draftId)) {
    throw buildInitializationError(
      "INVALID_CHECKOUT_DRAFT_ID",
      "Subscription checkout invoice metadata contains an invalid draftId",
      400
    );
  }

  const staleClaimMs = positiveInteger(
    options.staleClaimMs || process.env.SUBSCRIPTION_INVOICE_CLAIM_STALE_MS,
    DEFAULT_STALE_CLAIM_MS
  );
  const waitTimeoutMs = positiveInteger(
    options.waitTimeoutMs || process.env.SUBSCRIPTION_INVOICE_WAIT_TIMEOUT_MS,
    DEFAULT_WAIT_TIMEOUT_MS
  );
  const pollIntervalMs = positiveInteger(
    options.pollIntervalMs || process.env.SUBSCRIPTION_INVOICE_POLL_INTERVAL_MS,
    DEFAULT_POLL_INTERVAL_MS
  );
  const deadline = Date.now() + waitTimeoutMs;

  while (Date.now() <= deadline) {
    const existing = await CheckoutDraft.findById(draftId).lean();
    if (!existing) {
      throw buildInitializationError("CHECKOUT_DRAFT_NOT_FOUND", "Checkout draft not found", 404);
    }
    if (existing.providerInvoiceId && existing.paymentUrl) {
      return buildPersistedInvoiceResponse(existing, payload);
    }
    if (existing.status !== "pending_payment") {
      throw buildInitializationError(
        "CHECKOUT_NOT_PENDING",
        `Checkout draft is not pending payment (${existing.status})`
      );
    }

    const claim = await claimInvoiceInitialization({ draftId, staleClaimMs });
    if (claim) {
      return initializeClaimedInvoice({ claim, payload, createInvoiceFn });
    }

    await sleep(pollIntervalMs);
  }

  throw buildInitializationError(
    "CHECKOUT_IN_PROGRESS",
    "Checkout invoice is still being initialized; retry with the same idempotency key"
  );
}

module.exports = {
  createSubscriptionCheckoutInvoice,
  claimInvoiceInitialization,
  buildPersistedInvoiceResponse,
};
