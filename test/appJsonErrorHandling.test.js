const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const { createApp } = require("../src/app");

test("createApp returns a validation error for malformed JSON bodies", async () => {
  const app = createApp();

  const res = await request(app)
    .post("/api/subscriptions/quote")
    .set("Content-Type", "application/json")
    .set("Accept-Language", "en")
    .send('{"planId":');

  assert.equal(res.status, 400);
  assert.equal(res.body.status, false);
  assert.equal(res.body.error.code, "VALIDATION_ERROR");
  assert.equal(res.body.error.message, "Request body must be valid JSON");
});
