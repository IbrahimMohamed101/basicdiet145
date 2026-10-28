"use strict";
// Integration coverage uses a process-local MongoDB only. Never reads application database credentials.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const express = require("express");
const request = require("supertest");
const Lead = require("../src/models/LandingLead");
const Event = require("../src/models/LandingAnalyticsEvent");
const service = require("../src/services/landingLeadService");
const analytics = require("../src/services/landingAnalyticsService");
const { publicRouter } = require("../src/routes/landingLeads");

async function run() {
  const db = await MongoMemoryServer.create();
  try {
    await mongoose.connect(db.getUri());
    await Promise.all([Lead.init(), Event.init()]);
    process.env.LANDING_ANALYTICS_INGEST_SECRET = "local-integration-test-only";
    const app = express();
    app.use(express.json());
    app.use("/api/landing", publicRouter);
    const payload = {
      requestId: crypto.randomUUID(), name: "QA fixture", phone: "+966500000000",
      contactConsent: true, marketingConsent: false, planUnselected: true,
      location: "header", content: "menu_basic15_header|offer15|plan_to_confirm",
    };
    const submit = body => request(app).post("/api/landing/leads")
      .set("x-landing-analytics-key", process.env.LANDING_ANALYTICS_INGEST_SECRET).send(body);
    const outcomes = await Promise.all([submit(payload), submit(payload)]);
    assert.deepEqual(outcomes.map(item => item.status), [202, 202]);
    assert.equal(await Lead.countDocuments({}), 1);
    await submit({ ...payload, requestId: crypto.randomUUID() }).expect(202);
    assert.equal(await Lead.countDocuments({}), 1, "phone/day dedupe must survive another requestId");
    const listed = await service.listLeads({});
    assert.equal(listed.data.total, 1);
    const row = listed.data.rows[0];
    assert.equal(row.planSelectionStatus, "unselected");
    for (const key of ["planId", "daysCount", "grams", "mealsPerDay"]) assert.equal(row[key], null);
    assert.equal(row.fulfillmentMethod, "unspecified");
    for (const key of ["phoneHash", "dayBucket", "sessionId"]) assert.equal(key in row, false);
    assert.equal(row.verifiedSubscription, null);
    const mixed = await submit({ ...payload, planId: new mongoose.Types.ObjectId().toString() });
    assert.equal(mixed.status, 400);
    assert.equal(await Lead.countDocuments({}), 1);
    const sessionId = crypto.randomUUID();
    for (const event of ["lp_lead_opened", "lp_lead_submitted"]) {
      assert.equal((await analytics.recordEvent({ event, eventId: crypto.randomUUID(), sessionId,
        path: "/menu", location: "header", placement: "menu_basic15_header", planDays: null })).ok, true);
    }
    const report = await analytics.buildLandingAnalyticsReport({});
    assert.equal(report.kpis.uniqueLeads, 1);
    assert.equal(report.kpis.leadFormOpens, 1);
    assert.equal(report.kpis.leadFormCompleted, 1);
    assert.equal(report.kpis.leadFormCompletionRate, 100);
    assert.deepEqual(report.plans, [], "unselected leads cannot become plan preference statistics");
    assert.equal(report.leadSubmissionsByPlacement[0].key, "menu_basic15_header");
    console.log("Landing HTTP intake -> Mongo persistence -> dashboard read/report, dedupe and no-plan isolation: PASS");
  } finally {
    await mongoose.disconnect();
    await db.stop();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
