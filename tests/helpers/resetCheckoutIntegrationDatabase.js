"use strict";

process.env.NODE_ENV = "test";

const mongoose = require("mongoose");
const { ensureSafeForDestructiveOp } = require("../../src/utils/dbSafety");
const { resolveMongoUri } = require("../../src/utils/mongoUriResolver");

async function resetCheckoutIntegrationDatabase() {
  const uri = resolveMongoUri();

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  ensureSafeForDestructiveOp("resetCheckoutIntegrationDatabase");
  const databaseName = mongoose.connection.db.databaseName;
  await mongoose.connection.db.dropDatabase();
  console.log(`Checkout integration database reset: ${databaseName}`);
}

resetCheckoutIntegrationDatabase()
  .catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });
