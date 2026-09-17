#!/usr/bin/env node
"use strict";

require("dotenv").config();

const mongoose = require("mongoose");
const MenuOption = require("../src/models/MenuOption");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const MenuProduct = require("../src/models/MenuProduct");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");
const { resolveMongoUri } = require("../src/utils/mongoUriResolver");

const PRODUCT = Object.freeze({ id: "6a62197079ee075a57f70106", key: "basic_meal" });
const GROUP = Object.freeze({ id: "6a62197279ee075a57f70108", key: "carbs" });
const OPTIONS = Object.freeze([
  { id: "6a9b4dc89fbb9859232f41d5", key: "asian_white_rice" },
  { id: "6a9b4e0d9fbb9859232f41ef", key: "turmeric_rice" },
  { id: "6a9b4e329fbb9859232f4205", key: "grilled_vegetables" },
  { id: "6a9b4e5b9fbb9859232f4216", key: "pesto_pasta" },
]);
const EXECUTE_CONFIRMATION = "ATTACH_BASIC_MEAL_CARBS_OPTIONS";

const DEFAULT_MODELS = {
  MenuOption,
  MenuOptionGroup,
  MenuProduct,
  ProductGroupOption,
  ProductOptionGroup,
};

function parseArgs(argv = process.argv.slice(2)) {
  const values = {};
  for (const arg of argv) {
    if (arg === "--execute") {
      values.execute = true;
      continue;
    }
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (!match) throw new Error(`Unknown argument: ${arg}`);
    values[match[1]] = match[2];
  }
  return {
    execute: values.execute === true,
    confirmation: values.confirm || "",
    expectedHost: values["expected-host"] || "",
    expectedDatabase: values["expected-database"] || "",
    expectedProductKey: values["product-key"] || "",
    expectedGroupKey: values["group-key"] || "",
  };
}

function assertExecutionConfirmation(args, target) {
  if (!args.execute) return;
  const required = [
    ["--confirm", args.confirmation, EXECUTE_CONFIRMATION],
    ["--expected-host", args.expectedHost, target.host],
    ["--expected-database", args.expectedDatabase, target.database],
    ["--product-key", args.expectedProductKey, PRODUCT.key],
    ["--group-key", args.expectedGroupKey, GROUP.key],
  ];
  for (const [flag, actual, expected] of required) {
    if (!actual || String(actual) !== String(expected)) {
      throw new Error(`${flag} must exactly equal ${JSON.stringify(expected)} for live execution`);
    }
  }
}

function databaseTarget(connection) {
  const host = String(connection.host || "").trim().toLowerCase();
  const port = connection.port ? String(connection.port) : "";
  const database = String(connection.name || connection.db?.databaseName || "").trim();
  if (!host || !database) {
    throw new Error("Refusing ambiguous database identity: host and database must both be resolved");
  }
  return {
    host: port ? `${host}:${port}` : host,
    database,
    credentials: "<redacted>",
  };
}

function relationState(relation) {
  if (!relation) return { action: "CREATE", existing: null };
  const existing = {
    id: String(relation._id),
    isActive: relation.isActive !== false,
    isVisible: relation.isVisible !== false,
    isAvailable: relation.isAvailable !== false,
  };
  return {
    action:
      existing.isActive && existing.isVisible && existing.isAvailable
        ? "NO-OP"
        : "REACTIVATE",
    existing,
  };
}

async function loadAndValidateIdentity(models = DEFAULT_MODELS) {
  const [productsById, productsByKey, groupsById, groupsByKey, optionsById, optionsByKey, groupRelations, optionRelations] = await Promise.all([
    models.MenuProduct.find({ _id: PRODUCT.id }).lean(),
    models.MenuProduct.find({ key: PRODUCT.key }).lean(),
    models.MenuOptionGroup.find({ _id: GROUP.id }).lean(),
    models.MenuOptionGroup.find({ key: GROUP.key }).lean(),
    models.MenuOption.find({ _id: { $in: OPTIONS.map((option) => option.id) } }).lean(),
    models.MenuOption.find({ groupId: GROUP.id, key: { $in: OPTIONS.map((option) => option.key) } }).lean(),
    models.ProductOptionGroup.find({ productId: PRODUCT.id, groupId: GROUP.id }).lean(),
    models.ProductGroupOption.find({
      productId: PRODUCT.id,
      groupId: GROUP.id,
      optionId: { $in: OPTIONS.map((option) => option.id) },
    }).lean(),
  ]);

  if (productsById.length !== 1 || productsByKey.length !== 1 || String(productsByKey[0]._id) !== PRODUCT.id) {
    throw new Error("Basic Meal product ID/key identity mismatch or duplicate key");
  }
  if (groupsById.length !== 1 || groupsByKey.length !== 1 || String(groupsByKey[0]._id) !== GROUP.id) {
    throw new Error("Carbs group ID/key identity mismatch or duplicate key");
  }
  if (groupRelations.length !== 1) {
    throw new Error(`Expected exactly one Basic Meal -> Carbs ProductOptionGroup; found ${groupRelations.length}`);
  }
  const groupRelation = groupRelations[0];
  if (groupRelation.isActive === false || groupRelation.isVisible === false || groupRelation.isAvailable === false) {
    throw new Error("Basic Meal -> Carbs ProductOptionGroup is not active, visible, and available");
  }
  if (optionsById.length !== OPTIONS.length || optionsByKey.length !== OPTIONS.length) {
    throw new Error("Expected option identity is missing or duplicated inside the Carbs group");
  }

  const optionById = new Map(optionsById.map((option) => [String(option._id), option]));
  const keyedIds = new Map(optionsByKey.map((option) => [String(option.key), String(option._id)]));
  for (const expected of OPTIONS) {
    const option = optionById.get(expected.id);
    if (!option || option.key !== expected.key || keyedIds.get(expected.key) !== expected.id) {
      throw new Error(`Option ID/key mismatch for ${expected.id} (${expected.key})`);
    }
    if (String(option.groupId) !== GROUP.id) {
      throw new Error(`Option ${expected.id} belongs to a different group`);
    }
  }

  const relationsByOptionId = new Map();
  for (const relation of optionRelations) {
    const optionId = String(relation.optionId);
    const rows = relationsByOptionId.get(optionId) || [];
    rows.push(relation);
    relationsByOptionId.set(optionId, rows);
  }
  for (const expected of OPTIONS) {
    const rows = relationsByOptionId.get(expected.id) || [];
    if (rows.length > 1) {
      throw new Error(`Duplicate ProductGroupOption rows found for ${expected.id}`);
    }
  }

  return {
    product: productsById[0],
    group: groupsById[0],
    options: OPTIONS.map((expected) => optionById.get(expected.id)),
    relationsByOptionId,
  };
}

async function repairBasicMealCarbsRelations({ execute = false, models = DEFAULT_MODELS } = {}) {
  const identity = await loadAndValidateIdentity(models);
  const plan = OPTIONS.map((expected, index) => {
    const relation = (identity.relationsByOptionId.get(expected.id) || [])[0] || null;
    return {
      optionId: expected.id,
      key: expected.key,
      groupId: String(identity.options[index].groupId),
      ...relationState(relation),
    };
  });

  if (execute) {
    for (const [index, item] of plan.entries()) {
      if (item.action === "NO-OP") continue;
      await models.ProductGroupOption.updateOne(
        { productId: PRODUCT.id, groupId: GROUP.id, optionId: item.optionId },
        {
          $set: { isActive: true, isVisible: true, isAvailable: true },
          $setOnInsert: {
            productId: PRODUCT.id,
            groupId: GROUP.id,
            optionId: item.optionId,
            sortOrder: Number(identity.options[index].sortOrder || 0),
          },
        },
        { upsert: true, runValidators: true, setDefaultsOnInsert: true }
      );
    }

    const verification = await models.ProductGroupOption.find({
      productId: PRODUCT.id,
      groupId: GROUP.id,
      optionId: { $in: OPTIONS.map((option) => option.id) },
      isActive: true,
      isVisible: true,
      isAvailable: true,
    }).lean();
    const counts = new Map();
    for (const relation of verification) {
      const optionId = String(relation.optionId);
      counts.set(optionId, (counts.get(optionId) || 0) + 1);
    }
    for (const expected of OPTIONS) {
      if (counts.get(expected.id) !== 1) {
        throw new Error(`Post-repair verification failed for ${expected.id}`);
      }
    }
  }

  return {
    mode: execute ? "EXECUTE" : "DRY_RUN",
    product: { id: PRODUCT.id, key: identity.product.key, name: identity.product.name },
    group: { id: GROUP.id, key: identity.group.key, name: identity.group.name },
    plan,
  };
}

async function main() {
  const args = parseArgs();
  await mongoose.connect(resolveMongoUri(), {
    dbName: process.env.MONGO_DB || undefined,
    serverSelectionTimeoutMS: 10000,
    autoCreate: false,
    autoIndex: false,
  });
  try {
    const target = databaseTarget(mongoose.connection);
    assertExecutionConfirmation(args, target);
    const report = await repairBasicMealCarbsRelations({ execute: args.execute });
    console.log(JSON.stringify({ target, ...report }, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error(`[basic-meal-carbs-repair] ${error.message}`);
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    process.exitCode = 1;
  });
}

module.exports = {
  EXECUTE_CONFIRMATION,
  GROUP,
  OPTIONS,
  PRODUCT,
  assertExecutionConfirmation,
  databaseTarget,
  loadAndValidateIdentity,
  parseArgs,
  relationState,
  repairBasicMealCarbsRelations,
};
