#!/usr/bin/env node
"use strict";

require("dotenv").config();

const mongoose = require("mongoose");
const { resolveMongoUri, getDbNameFromUri } = require("../src/utils/mongoUriResolver");
const {
  repairDuplicateBaseMealAllocations,
} = require("../src/services/subscription/subscriptionDuplicateMealAllocationRepairService");

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

function requireObjectId(value, label) {
  if (!value || !mongoose.Types.ObjectId.isValid(String(value))) {
    throw new Error(`${label} must be a valid ObjectId`);
  }
  return new mongoose.Types.ObjectId(String(value));
}

function optionalNumber(name) {
  const value = readArg(name);
  if (value === null) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`--${name} must be numeric`);
  return parsed;
}

async function main() {
  const subscriptionId = requireObjectId(readArg("subscription-id"), "--subscription-id");
  const dayIdValue = readArg("day-id");
  const dayId = dayIdValue ? requireObjectId(dayIdValue, "--day-id") : null;
  const date = String(readArg("date", "") || "").trim();
  if (!dayId && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Provide --day-id or a valid --date=YYYY-MM-DD");
  }

  const apply = hasFlag("apply");
  if (apply && !hasFlag("confirm-duplicate-base-meal-repair")) {
    throw new Error("Apply mode requires --confirm-duplicate-base-meal-repair");
  }
  if (!apply && hasFlag("confirm-duplicate-base-meal-repair")) {
    throw new Error("Confirmation flag is only valid together with --apply");
  }

  const expected = {
    totalMeals: optionalNumber("expected-total-meals"),
    remainingMeals: optionalNumber("expected-remaining-meals"),
    reservedMeals: optionalNumber("expected-reserved-meals"),
    duplicateReservationCount: optionalNumber("expected-duplicate-count"),
  };

  if (apply) {
    for (const [key, value] of Object.entries(expected)) {
      if (value === undefined) {
        throw new Error(`Apply mode requires an explicit expected value for ${key}`);
      }
    }
  }

  const uri = resolveMongoUri();
  console.log(`Database: ${getDbNameFromUri(uri)}`);
  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`Subscription: ${subscriptionId}`);
  console.log(`Day: ${dayId || date}`);

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    const result = await repairDuplicateBaseMealAllocations({
      subscriptionId,
      dayId,
      date: date || null,
      apply,
      expected,
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    code: error && error.code || "REPAIR_FAILED",
    message: error && error.message || "Repair failed",
    details: error && error.details,
  }, null, 2));
  process.exitCode = 1;
});
