"use strict";

// Invoked only after the unchanged legacy CLI fails. Observe the original failure
// without editing its source or exposing messages, commands, credentials or data.
const { MongoClient, Db } = require("mongodb");
const { diagnostic } = require("../g2-rs0-init-and-verify");
let stage = "config";
const connect = MongoClient.prototype.connect;
MongoClient.prototype.connect = async function (...args) {
  stage = "connect";
  return connect.apply(this, args);
};
const command = Db.prototype.command;
Db.prototype.command = async function (document, ...args) {
  if (document.hello) stage = "hello";
  if (document.replSetInitiate) stage = "initiate";
  return command.call(this, document, ...args);
};
const manifest = require("../g2-mongo-manifest");
const collect = manifest.collect;
manifest.collect = async function (...args) {
  stage = "collect";
  return collect(...args);
};
process.argv = [process.execPath, "scripts/.g2-legacy-init.js"];
require("../.g2-legacy-init").main().then(() => {
  process.stdout.write("G2_LEGACY_DIAGNOSTIC_PASS\n");
}, error => {
  error.g2Stage = stage;
  process.stderr.write(diagnostic(error));
  process.exitCode = 1;
});
