"use strict";

const MetaLandingEvent = require("../models/MetaLandingEvent");
const { logger } = require("../utils/logger");

const MAX_ATTEMPTS = 5;
const DAY = 86400000;
const SOURCE_PATHS = new Set(["/", "/menu", "/jeddah/healthy-meals"]);

function metaConfigured(env = process.env) {
  return env.META_CAPI_ENABLED === "true"
    && /^\d{8,20}$/.test(env.META_CAPI_PIXEL_ID || "")
    && typeof env.META_CAPI_ACCESS_TOKEN === "string"
    && env.META_CAPI_ACCESS_TOKEN.length >= 20;
}
function validFbp(value) {
  return typeof value === "string" && /^fb\.1\.\d{8,16}\.\d{1,40}$/.test(value) ? value : "";
}
function validFbc(value) {
  return typeof value === "string" && /^fb\.1\.\d{8,16}\.[A-Za-z0-9_-]{1,180}$/.test(value) ? value : "";
}
function safePath(value) {
  return SOURCE_PATHS.has(value) ? value : "/menu";
}

/**
 * Called only after new lead persistence. When disabled, no outbox records
 * are created and no data is sent to Meta. The payload contains no PII.
 */
async function queueConsentedMetaLead(body, { Model = MetaLandingEvent, env = process.env, now = new Date() } = {}) {
  if (!metaConfigured(env) || body?.adsTrackingConsent !== true) return { queued: false };
  const fbp = validFbp(body.fbp);
  const fbc = validFbc(body.fbc);
  if (!fbp && !fbc) return { queued: false };
  try {
    await Model.create({
      eventId: body.requestId.toLowerCase(), eventName: "Lead",
      occurredAt: now, sourcePath: safePath(body.pagePath),
      fbp, fbc, nextAttemptAt: now,
      expiresAt: new Date(now.getTime() + 6 * DAY),
    });
    return { queued: true };
  } catch (error) {
    if (error?.code === 11000) return { queued: false }; // idempotent by requestId
    // A Meta integration failure must never break a real customer registration.
    logger.warn("Meta Lead outbox enqueue failed (no personal details logged)");
    return { queued: false };
  }
}

function buildMetaPayload(record, { env = process.env } = {}) {
  const user_data = {};
  const fbp = validFbp(record.fbp);
  const fbc = validFbc(record.fbc);
  if (fbp) user_data.fbp = fbp;
  if (fbc) user_data.fbc = fbc;
  if (!Object.keys(user_data).length) return null;
  const body = {
    data: [{
      event_name: "Lead", event_time: Math.floor(new Date(record.occurredAt).getTime() / 1000),
      event_id: record.eventId, action_source: "website",
      event_source_url: "https://basicdietksa.com" + safePath(record.sourcePath),
      user_data,
    }],
  };
  // Explicit staging-only opt-in: never attach a test code in production by accident.
  if (env.META_CAPI_TEST_MODE === "true" && env.META_CAPI_TEST_EVENT_CODE) {
    body.test_event_code = env.META_CAPI_TEST_EVENT_CODE;
  }
  return body;
}

async function sendMetaLead(record, { env = process.env, fetchImpl = fetch } = {}) {
  if (!metaConfigured(env)) return false;
  const payload = buildMetaPayload(record, { env });
  if (!payload) return false;
  const graphVersion = /^v\d{1,2}\.0$/.test(env.META_CAPI_GRAPH_VERSION || "")
    ? env.META_CAPI_GRAPH_VERSION : "v25.0";
  // No secrets or customer details in URL or logs.
  const endpoint = "https://graph.facebook.com/" + graphVersion + "/"
    + env.META_CAPI_PIXEL_ID + "/events";
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": "Bearer " + env.META_CAPI_ACCESS_TOKEN,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000),
  });
  return response.ok;
}

/**
 * Leased, retryable outbox: separate from the form response and durable
 * through a process restart. Caller invokes from existing background job.
 */
async function processMetaLandingOutbox({ Model = MetaLandingEvent, env = process.env,
  fetchImpl = fetch, now = () => new Date(), maxItems = 10 } = {}) {
  const result = { sent: 0, retried: 0, failed: 0 };
  if (!metaConfigured(env)) return result;
  for (let i = 0; i < Math.min(Math.max(0, maxItems), 25); i += 1) {
    const current = now();
    const record = await Model.findOneAndUpdate({
      $or: [
        { state: "pending", nextAttemptAt: { $lte: current } },
        { state: "processing", leaseUntil: { $lt: current } },
      ],
      expiresAt: { $gt: current },
    }, { $set: { state: "processing", leaseUntil: new Date(current.getTime() + 60000) },
      $inc: { attempts: 1 } }, { sort: { nextAttemptAt: 1 }, new: true });
    if (!record) break;
    let sent = false;
    try {
      sent = await sendMetaLead(record, { env, fetchImpl });
    } catch {
      // Do not log raw Meta HTTP responses or auth credentials.
    }
    if (sent) {
      await Model.updateOne({ _id: record._id, state: "processing" },
        { $set: { state: "sent", fbp: "", fbc: "", leaseUntil: null } });
      result.sent += 1;
    } else {
      const exhausted = record.attempts >= MAX_ATTEMPTS;
      const retryDelay = Math.min(60 * 60 * 1000, 60000 * 2 ** Math.max(0, record.attempts - 1));
      await Model.updateOne({ _id: record._id, state: "processing" }, {
        $set: {
          state: exhausted ? "failed" : "pending",
          leaseUntil: null, nextAttemptAt: new Date(current.getTime() + retryDelay),
          ...(exhausted ? { fbp: "", fbc: "" } : {}),
        },
      });
      if (exhausted) result.failed += 1;
      else result.retried += 1;
    }
  }
  return result;
}

module.exports = {
  metaConfigured, validFbp, validFbc, safePath, queueConsentedMetaLead,
  buildMetaPayload, sendMetaLead, processMetaLandingOutbox,
};
