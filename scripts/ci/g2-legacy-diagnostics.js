"use strict";

// Run the packaged legacy main without editing its source or changing its exit
// classification. Log only versions and safe original failure metadata.
const { MongoClient, Db } = require("mongodb");
const { version: driverVersion } = require("mongodb/package.json");
const { diagnostic } = require("../g2-rs0-init-and-verify");
// These are the immutable c458055 CLI's exact classifications.
const EXIT_CODES = Object.freeze({
  G2_OWNER_APPROVAL_REQUIRED: 64,
  G2_MANIFEST_REQUIRED: 71,
  G2_MAINTENANCE_REQUIRED: 72,
  G2_UNSAFE_TARGET: 65,
  G2_INIT_FAILED: 66,
  G2_PRIMARY_TIMEOUT: 67,
  G2_MANIFEST_MISMATCH: 68,
  G2_TRANSACTION_FAILED: 69,
  G2_UNEXPECTED_FAILURE: 70,
});
let stage = "config";
const connect = MongoClient.prototype.connect;
MongoClient.prototype.connect = async function (...args) {
  stage = "connect";
  return connect.apply(this, args);
};
const command = Db.prototype.command;
Db.prototype.command = async function (document, ...args) {
  if (document.hello) stage = "hello";
  if (document.replSetInitiate) {
    stage = "initiate";
    process.stdout.write("G2_INITIATE_SENT\n");
  }
  return command.call(this, document, ...args);
};
const manifest = require("../g2-mongo-manifest");
const collect = manifest.collect;
manifest.collect = async function (...args) {
  stage = "collect";
  return collect(...args);
};
process.stderr.write(`G2_RUNTIME node=${process.version} driver=${driverVersion}\n`);
process.argv = [process.execPath, "scripts/.g2-legacy-init.js", ...process.argv.slice(2)];
require("../.g2-legacy-init").main().then(() => {
  process.stdout.write("G2_LEGACY_EXIT=0\n");
  process.stdout.write("G2_LEGACY_DIAGNOSTIC_PASS\n");
}, error => {
  const code = Object.hasOwn(EXIT_CODES, error.code) ? EXIT_CODES[error.code] : EXIT_CODES.G2_UNEXPECTED_FAILURE;
  error.g2Stage = stage;
  process.stderr.write(diagnostic(error));
  process.stdout.write(`G2_LEGACY_EXIT=${code}\n`);
  process.exitCode = code;
});
