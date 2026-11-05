"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeSnapshot } = require("../src/services/pos/catalogService");
const staging = require("../src/services/pos/stagingCatalog.json");

test("published history retains exact prices and cryptographic content hash", () => {
  const published = structuredClone(staging);
  const original = published.products[0].variants[0].prices.restaurant;
  const saved = makeSnapshot(7, published, new Date("2026-11-05T00:00:00Z"));
  assert.equal(saved._id, "pos-menu:7");
  assert.equal(saved.revision, 7);
  assert.equal(saved.catalog.products[0].variants[0].prices.restaurant, original);
  assert.match(saved.contentSha256, /^[a-f0-9]{64}$/);
  const repeated = makeSnapshot(7, staging, new Date("2026-11-05T01:00:00Z"));
  assert.equal(repeated.contentSha256, saved.contentSha256);
  published.products[0].variants[0].prices.restaurant = 1;
  assert.equal(saved.catalog.products[0].variants[0].prices.restaurant, original);
  assert.notEqual(makeSnapshot(7, published).contentSha256, saved.contentSha256);
});

test("rejects invalid catalog snapshots and unsafe revisions", () => {
  for (const revision of [0, -1, 1.5, "1", undefined]) {
    assert.throws(() => makeSnapshot(revision, staging), /invalid/i);
  }
  assert.throws(() => makeSnapshot(1, {}), /invalid/i);
  assert.throws(() => makeSnapshot(1, null), /invalid/i);
});
