"use strict";

const mongoose = require("mongoose");

const PATCH_KEY = Symbol.for("basicdiet.tests.mongoCatalogStability.patched");
const ORIGINAL_CONNECT_KEY = Symbol.for("basicdiet.tests.mongoCatalogStability.originalConnect");

async function initializeRegisteredModels() {
  let previousSignature = "";

  // A service required during initialization may register another model. Repeat
  // until the model registry is stable, while keeping index creation sequential
  // so MongoMemoryReplSet does not change the catalog during a transaction.
  for (let pass = 0; pass < 5; pass += 1) {
    const modelNames = mongoose.modelNames().sort();
    for (const modelName of modelNames) {
      await mongoose.model(modelName).init();
    }

    const signature = mongoose.modelNames().sort().join("|");
    if (signature === previousSignature) {
      await mongoose.connection.db.command({ ping: 1 });
      return;
    }
    previousSignature = signature;
  }

  const err = new Error("Mongoose model registry did not stabilize before transaction tests");
  err.code = "TEST_MONGO_MODEL_REGISTRY_UNSTABLE";
  throw err;
}

function installMongoCatalogStabilityPatch() {
  if (globalThis[PATCH_KEY]) return globalThis[PATCH_KEY];

  const originalConnect = mongoose.connect.bind(mongoose);
  globalThis[ORIGINAL_CONNECT_KEY] = originalConnect;

  mongoose.connect = async function connectWithCatalogReadiness(...args) {
    const result = await originalConnect(...args);
    await initializeRegisteredModels();
    return result;
  };

  const state = Object.freeze({ installed: true });
  globalThis[PATCH_KEY] = state;
  return state;
}

installMongoCatalogStabilityPatch();

module.exports = {
  initializeRegisteredModels,
  installMongoCatalogStabilityPatch,
};
