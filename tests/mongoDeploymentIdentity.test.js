"use strict";

const assert = require("node:assert");
const {
  buildMongoDeploymentIdentityHash,
  normalizeMongoDeploymentIdentity,
} = require("../src/utils/mongoDeploymentIdentity");

function run() {
  const first = "mongodb://user:first-secret@db.example.com:27017/basicdiet_staging?retryWrites=true";
  const rotated = "mongodb://user:rotated-secret@db.example.com:27017/basicdiet_staging?retryWrites=false";
  const otherDatabase = "mongodb://user:first-secret@db.example.com:27017/basicdiet_production";
  const otherHost = "mongodb://user:first-secret@other-db.example.com:27017/basicdiet_staging";

  assert.strictEqual(
    normalizeMongoDeploymentIdentity(first),
    "mongodb|db.example.com:27017|basicdiet_staging"
  );
  assert.strictEqual(
    buildMongoDeploymentIdentityHash(first),
    buildMongoDeploymentIdentityHash(rotated),
    "credential rotation and query options must not change deployment identity"
  );
  assert.notStrictEqual(
    buildMongoDeploymentIdentityHash(first),
    buildMongoDeploymentIdentityHash(otherDatabase),
    "database name must be part of deployment identity"
  );
  assert.notStrictEqual(
    buildMongoDeploymentIdentityHash(first),
    buildMongoDeploymentIdentityHash(otherHost),
    "database host must be part of deployment identity"
  );
  assert.strictEqual(buildMongoDeploymentIdentityHash(""), null);
  assert.strictEqual(buildMongoDeploymentIdentityHash("https://example.com/db"), null);

  console.log("Mongo deployment identity tests passed");
}

run();
