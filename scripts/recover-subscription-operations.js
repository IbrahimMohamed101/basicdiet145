#!/usr/bin/env node
"use strict";

require("dotenv").config();

const mongoose = require("mongoose");
const { resolveMongoUri, getDbNameFromUri } = require("../src/utils/mongoUriResolver");
const {
  DEFAULT_STALE_MS,
  inspectAndRecoverOperations,
} = require("../src/services/subscription/subscriptionOperationRecoveryService");

function readArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith("--")) {
    return process.argv[index + 1];
  }
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function positiveInt(value, fallback) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

async function main() {
  const apply = hasFlag("apply");
  const operationType = String(readArg("type", "all")).trim();
  const operationId = readArg("operation-id", null);
  const limit = positiveInt(readArg("limit", "100"), 100);
  const staleMinutes = positiveInt(readArg("stale-minutes", String(DEFAULT_STALE_MS / 60000)), DEFAULT_STALE_MS / 60000);
  const staleMs = staleMinutes * 60 * 1000;

  if (!["all", "append", "daily-addon"].includes(operationType)) {
    throw new Error("--type must be all, append, or daily-addon");
  }
  if (apply && !hasFlag("confirm-safe-recovery")) {
    throw new Error("--apply requires --confirm-safe-recovery");
  }

  const uri = resolveMongoUri();
  console.log(`Database: ${getDbNameFromUri(uri)}`);
  console.log(`Mode: ${apply ? "APPLY SAFE ACTIONS" : "DRY RUN"}`);
  console.log(`Type: ${operationType}`);
  console.log(`Stale threshold: ${staleMinutes} minutes`);
  if (operationId) console.log(`Operation: ${operationId}`);

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    const report = await inspectAndRecoverOperations({
      apply,
      operationType,
      operationId,
      limit,
      staleMs,
    });
    console.log(JSON.stringify(report, null, 2));
    if (report.reviewRequiredCount > 0) {
      console.error(`${report.reviewRequiredCount} operation(s) require manual review or idempotent API retry.`);
      process.exitCode = 2;
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(async (error) => {
  console.error(error && error.stack ? error.stack : error);
  try {
    await mongoose.disconnect();
  } catch (_error) {
    // Ignore shutdown failures after the original error.
  }
  process.exitCode = 1;
});
