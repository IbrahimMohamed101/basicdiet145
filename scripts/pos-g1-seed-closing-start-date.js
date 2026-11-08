#!/usr/bin/env node
"use strict";
// Staging-only fixture. Never runs during server startup or deployment.
// Explicit execution requires the isolated Railway Staging identity and rs0.
const mongoose = require("mongoose");
const { isPosStagingRuntime, preparePosStagingRuntime } = require("../src/utils/posStagingRuntime");
const { seedStagingClosingStartDate } = require("../src/services/pos/closingVersionService");
async function main() {
  if (!isPosStagingRuntime() || !process.env.POS_STAGING_MONGO_URL) {
    throw new Error("Refusing non-isolated Staging closing migration");
  }
  preparePosStagingRuntime(process.env);
  const uri = process.env.MONGO_URI;
  if (!uri.includes("mongodb-qxhu.railway.internal") ||
      !uri.includes("/basicdiet_pos_staging_test")) {
    throw new Error("Refusing unexpected Mongo connection");
  }
  await mongoose.connect(uri);
  try {
    const result = await seedStagingClosingStartDate();
    process.stdout.write(JSON.stringify({ key: "posClosingStartDate", ...result }) + "\n");
  } finally { await mongoose.disconnect(); }
}
main().catch(e => { process.stderr.write(e.message + "\n"); process.exitCode = 1; });
