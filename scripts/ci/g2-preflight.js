"use strict";

// Read-only reference diagnostics for preDeploy. No database connections.
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { configuration } = require("./g2-synthetic-seed");

function report(env = process.env) {
  const { uri: target, dbName } = configuration(env);
  const host = env.G2_EXECUTION_SCOPE === "staging-isolated" ? "staging-drill" : "ci-disposable";
  const lines = [];
  for (const name of ["G2_MONGO_URI", "MONGO_URI"]) {
    if (env[name] === undefined && name === "MONGO_URI") continue;
    const uri = new URL(env[name]);
    assert.equal(uri.protocol, "mongodb:");
    assert.equal(uri.hostname, target.hostname);
    assert.equal(uri.port, target.port);
    assert.equal(uri.pathname, target.pathname);
    assert.equal(uri.searchParams.get("authSource"), "admin");
    if (uri.searchParams.has("replicaSet")) assert.equal(uri.searchParams.get("replicaSet"), "rs0");
    if (uri.searchParams.has("directConnection")) assert.equal(uri.searchParams.get("directConnection"), "true");
    const options = ["authSource", "replicaSet", "directConnection"].filter(option => uri.searchParams.has(option));
    // host reports the validated target's role, never its DNS name or address.
    lines.push(`G2_PREFLIGHT uri=${name} scheme=mongodb host=${host} db=${dbName} required_options=authSource options=${options.join(",")}`);
  }
  assert.ok(typeof env.G2_BASELINE_MANIFEST_GZ_B64 === "string" && env.G2_BASELINE_MANIFEST_GZ_B64.length > 0);
  for (const name of ["G2_BASELINE_MANIFEST_B64", "G2_BASELINE_MANIFEST_GZ_B64"]) {
    if (env[name] === undefined) continue;
    const value = env[name];
    assert.equal(typeof value, "string");
    const hash = createHash("sha256").update(value, "utf8").digest("hex");
    lines.push(`G2_PREFLIGHT variable=${name} chars=${value.length} bytes=${Buffer.byteLength(value, "utf8")} sha256=${hash}`);
  }
  return lines.join("\n") + "\n";
}

if (require.main === module) {
  try {
    process.stdout.write(report());
  } catch {
    process.stderr.write("G2_PREFLIGHT_FAILED\n");
    process.exitCode = 1;
  }
}

module.exports = { report };
