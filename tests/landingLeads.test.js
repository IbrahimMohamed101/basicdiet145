"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const service = require("../src/services/landingLeadService");
const Plan = require("../src/models/Plan");
const Lead = require("../src/models/LandingLead");
const { isTrustedLanding } = require("../src/routes/landingLeads");

const ID = "507f1f77bcf86cd799439011";
const base = () => ({
  requestId: crypto.randomUUID(), planId: ID, daysCount: 26, grams: 150,
  mealsPerDay: 2, phone: "0501234567",
  contactConsent: true, marketingConsent: false, location: "benefits",
  fulfillmentMethod: "pickup",
  campaign: "حملة_جدة", sessionId: crypto.randomUUID(),
});
const plan = {
  _id: ID, daysCount: 26,
  gramsOptions: [
    { grams: 150, isActive: true, mealsOptions: [{ mealsPerDay: 2, isActive: true, priceHalala: 110000 }] },
    { grams: 200, isActive: false, mealsOptions: [{ mealsPerDay: 2, priceHalala: 140000 }] },
  ],
};

async function run() {
  assert.equal(service.normalizeSaudiPhone("0501234567"), "+966501234567");
  assert.equal(service.normalizeSaudiPhone("+966501234567"), "+966501234567");
  assert.equal(service.normalizeSaudiPhone("966 501 234 567"), "+966501234567");
  assert.equal(service.normalizeSaudiPhone("501234567"), "+966501234567");
  assert.equal(service.normalizeSaudiPhone("0112345678"), null);
  assert.equal(service.normalizeSaudiPhone("some+966501234567"), null);
  assert.ok(service.isValidRequest(base()));
  assert.equal(Boolean(service.isValidRequest({ ...base(), contactConsent: false })), false);
  assert.equal(Boolean(service.isValidRequest({ ...base(), planId: "__proto__" })), false);
  assert.equal(Boolean(service.isValidRequest({ ...base(), daysCount: 14 })), false);
  assert.equal(Boolean(service.isValidRequest({ ...base(), mealsPerDay: 0 })), false);
  assert.equal(Boolean(service.isValidRequest({ ...base(), requestId: "wrong" })), false);
  assert.equal(Boolean(service.isValidRequest({ ...base(), fulfillmentMethod: "courier" })), false);
  assert.equal(Boolean(service.isValidRequest({ ...base(), fulfillmentMethod: null })), false);
  assert.ok(service.isValidRequest({ ...base(), fulfillmentMethod: undefined }));

  const previousSecret = process.env.LANDING_ANALYTICS_INGEST_SECRET;
  process.env.LANDING_ANALYTICS_INGEST_SECRET = "test-only-secret-no-production";
  const req = key => ({ get: () => key });
  assert.equal(isTrustedLanding(req("test-only-secret-no-production")), true);
  assert.equal(isTrustedLanding(req("other-value")), false);

  const oldFindOne = Plan.findOne;
  const oldFind = Plan.find;
  const oldCreate = Lead.create;
  const oldViable = Plan.isViable;
  let saved = null;
  try {
    Plan.findOne = () => ({ lean: async () => plan });
    Lead.create = async values => { saved = values; return values; };
    const first = await service.submitLead(base());
    assert.deepEqual(first, { ok: true, created: true });
    assert.equal(saved.phone, "+966501234567");
    assert.equal(saved.contactConsent, true);
    assert.equal(saved.marketingConsent, false);
    assert.equal(saved.campaign, "حملة_جدة");
    assert.equal(saved.fulfillmentMethod, "pickup");
    assert.equal(saved.location, "benefits");
    const fallback = await service.submitLead({ ...base(), fulfillmentMethod: undefined });
    assert.equal(fallback.ok, true);
    assert.equal(saved.fulfillmentMethod, "unspecified");
    assert.equal(saved.phoneHash.length, 64);
    assert.equal(saved.status, undefined);
    assert.equal(saved.expiresAt.getTime() > Date.now(), true);
    assert.equal(Object.keys(saved).includes("ipAddress"), false);

    assert.equal((await service.submitLead({ ...base(), grams: 200 })).code, "OPTION_UNAVAILABLE");
    assert.equal((await service.submitLead({ ...base(), mealsPerDay: 5 })).code, "OPTION_UNAVAILABLE");
    Plan.findOne = () => ({ lean: async () => null });
    assert.equal((await service.submitLead(base())).code, "PLAN_UNAVAILABLE");
    Plan.findOne = () => ({ lean: async () => plan });
    saved = null;
    assert.deepEqual(await service.submitLead({ ...base(), website: "bot" }), { ok: true, created: false });
    assert.equal(saved, null);

    Lead.create = async () => { const e = new Error("duplicate"); e.code = 11000; throw e; };
    assert.deepEqual(await service.submitLead(base()), { ok: true, created: false });

    const planWithUnavailableGram = { ...plan, gramsOptions: [
      ...plan.gramsOptions,
      { grams: 100, isActive: true, mealsOptions: [{ mealsPerDay: 1, isActive: false }] },
    ] };
    Plan.isViable = () => true; // Fixture verifies filtering even when an imported plan is partially invalid.
    Plan.find = () => ({
      sort: () => ({ lean: async () => [planWithUnavailableGram] }),
    });
    const plans = await service.getAvailableOptions();
    assert.deepEqual(plans, [{
      planId: ID, daysCount: 26,
      gramsOptions: [{ grams: 150, mealsPerDay: [2] }],
    }]);
  } finally {
    Plan.findOne = oldFindOne;
    Plan.find = oldFind;
    Plan.isViable = oldViable;
    Lead.create = oldCreate;
    if (previousSecret === undefined) delete process.env.LANDING_ANALYTICS_INGEST_SECRET;
    else process.env.LANDING_ANALYTICS_INGEST_SECRET = previousSecret;
  }
  console.log("Landing lead normalization, opt-in, plan validation, privacy, dedupe: PASS");
}
run().catch(e => { console.error(e); process.exitCode = 1; });
