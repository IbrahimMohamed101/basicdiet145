"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildSanitizedStagingFixture } =
  require("../scripts/pos/buildSanitizedStagingFixture");
const sample = require("../fixtures/pos/public-menu-nonpersonal-sample.json");

test("public business menu becomes an inactive, zero-PII, no-implicit-price draft", () => {
  const fixture = buildSanitizedStagingFixture(sample);
  assert.equal(fixture.products.length, 12);
  assert.ok(fixture.products.every((product) => product.active === false));
  assert.ok(fixture.products.every((product) =>
    product.variants.every((variant) =>
      Object.values(variant.prices).every((price) => price === null))));
  assert.deepEqual(fixture.channels.map((channel) => channel.id),
    ["restaurant", "hungerstation", "keeta"]);
  assert.ok(fixture.products.every((item) => !Object.hasOwn(item, "email")));
  assert.ok(fixture.products.every((item) => !Object.hasOwn(item, "phone")));
});

test("never copies customers, payments, secret values or raw database collections", () => {
  for (const dangerous of [
    { ...sample, customers: [{ phone: "0500000000" }] },
    { ...sample, payments: [{ card: "1234567890" }] },
    { ...sample, users: [] },
  ]) {
    assert.throws(() => buildSanitizedStagingFixture(dangerous), /prohibited/);
  }
  const phoneProduct = structuredClone(sample);
  phoneProduct.products[0].name = "رقم العميل 0500000000";
  assert.throws(() => buildSanitizedStagingFixture(phoneProduct), /Unsafe/);
  const emailProduct = structuredClone(sample);
  emailProduct.products[0].name = "customer@example.com";
  assert.throws(() => buildSanitizedStagingFixture(emailProduct), /Unsafe/);
});

test("untrusted source prices and notes do not cross into independent POS pricing", () => {
  const input = structuredClone(sample);
  input.products[0].price = 999999;
  input.products[0].notes = "secret private note";
  input.products[0].clientId = "customer-123";
  const json = JSON.stringify(buildSanitizedStagingFixture(input));
  assert.ok(!json.includes("999999"));
  assert.ok(!json.includes("secret private note"));
  assert.ok(!json.includes("customer-123"));
});
