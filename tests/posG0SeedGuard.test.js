"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, writeFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const SCRIPT = join(__dirname, "../scripts/pos-g0-seed-isolated-staging.js");
function run(body, apply = false) {
  const dir = mkdtempSync(join(tmpdir(), "pos-g0-seed-"));
  try {
    const file = join(dir, "config.json");
    writeFileSync(file, JSON.stringify(body));
    return spawnSync(process.execPath, [SCRIPT, "--config=" + file, ...(apply ? ["--apply"] : [])], {
      encoding: "utf8",
      env: { ...process.env, MONGODB_URI: "",
        RAILWAY_ENVIRONMENT: "production", POS_STAGING_ISOLATED: "false" },
      timeout: 15000,
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
test("G0 seed dry-run does not connect to a database or use Production", () => {
  const p = run({ plans: [{ daysCount: 26, gramsOptions: [] }], zones: [] });
  assert.equal(p.status, 0, p.stderr);
  const out = JSON.parse(p.stdout);
  assert.equal(out.dryRun, true);
  assert.equal(out.configCounts.plans, 1);
});
test("G0 seed rejects every unapproved collection, including customers", () => {
  const p = run({ customers: [{ name: "any" }] });
  assert.equal(p.status, 1);
  assert.match(p.stderr, /Unapproved collection/);
});
test("G0 seed rejects nested PII even in an allowed config collection", () => {
  const p = run({ settings: [{ key: "s", value: { customer: { email: "x@example.com" } } }] });
  assert.equal(p.status, 1);
  assert.match(p.stderr, /Forbidden data field/);
});
test("G0 seed cannot --apply to Production even with allowlisted config", () => {
  const p = run({ plans: [] }, true);
  assert.equal(p.status, 1);
  assert.match(p.stderr, /MONGODB_URI required|Seed blocked/);
});
