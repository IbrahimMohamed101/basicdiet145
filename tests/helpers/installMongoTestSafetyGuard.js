"use strict";

const mongoose = require("mongoose");
const { MongoClient } = require("mongodb");
const {
  assertSafeTestMongoUri,
  getDbNameFromUri,
} = require("../../src/utils/mongoUriResolver");

const INSTALL_MARK = Symbol.for("basicdiet.testMongoSafetyGuard.installed");
const ORIGINAL_CONNECT = Symbol.for("basicdiet.testMongoSafetyGuard.originalConnect");
const MONGO_CLIENT_INSTALL_MARK = Symbol.for("basicdiet.testMongoSafetyGuard.mongoClientInstalled");

function isLoopbackMemoryServerUri(uri) {
  try {
    const parsed = new URL(uri);
    const host = String(parsed.hostname || "").toLowerCase();
    const port = Number(parsed.port || 27017);
    return (host === "127.0.0.1" || host === "localhost" || host === "::1") && port !== 27017;
  } catch (_error) {
    return false;
  }
}

function assertConfiguredTestConnection(uri, options = {}, env = process.env) {
  if (env.NODE_ENV !== "test") {
    throw new Error(`Safety block: NODE_ENV must be "test" before any test MongoDB connection.`);
  }

  const candidateDbName = String(options.dbName || getDbNameFromUri(uri) || "").trim();
  const isEphemeralMemoryServer = isLoopbackMemoryServerUri(uri);

  if (!isEphemeralMemoryServer && !env.MONGO_URI_TEST) {
    throw new Error("Safety block: MONGO_URI_TEST is required for MongoDB-writing tests.");
  }

  if (!isEphemeralMemoryServer && env.MONGO_URI_TEST) {
    assertSafeTestMongoUri(env.MONGO_URI_TEST, { env });
  }

  assertSafeTestMongoUri(uri, {
    env,
    // A MongoMemoryServer on a non-default loopback port is process-local and
    // cannot be the Railway production cluster. Its generated dbName does not
    // need to follow external-database naming rules.
    databaseName: isEphemeralMemoryServer ? `memory_${process.pid}_test` : candidateDbName,
  });
}

function installMongoTestSafetyGuard(target = mongoose) {
  if (target[INSTALL_MARK]) return target;

  const originalConnect = target.connect.bind(target);
  Object.defineProperty(target, ORIGINAL_CONNECT, { value: originalConnect });
  target.connect = async function guardedMongooseConnect(uri, options = {}) {
    assertConfiguredTestConnection(uri, options, process.env);
    return originalConnect(uri, options);
  };
  Object.defineProperty(target, INSTALL_MARK, { value: true });
  return target;
}

function installMongoClientTestSafetyGuard(MongoClientClass = MongoClient) {
  if (MongoClientClass.prototype[MONGO_CLIENT_INSTALL_MARK]) return MongoClientClass;
  const originalConnect = MongoClientClass.prototype.connect;
  MongoClientClass.prototype.connect = async function guardedMongoClientConnect(...args) {
    assertConfiguredTestConnection(this?.s?.url || "", {}, process.env);
    return originalConnect.apply(this, args);
  };
  Object.defineProperty(MongoClientClass.prototype, MONGO_CLIENT_INSTALL_MARK, { value: true });
  return MongoClientClass;
}

async function executeWithGuaranteedCleanup(operation, cleanup) {
  try {
    return await operation();
  } finally {
    await cleanup();
  }
}

installMongoTestSafetyGuard();
installMongoClientTestSafetyGuard();

module.exports = {
  assertConfiguredTestConnection,
  executeWithGuaranteedCleanup,
  installMongoTestSafetyGuard,
  installMongoClientTestSafetyGuard,
  isLoopbackMemoryServerUri,
};
