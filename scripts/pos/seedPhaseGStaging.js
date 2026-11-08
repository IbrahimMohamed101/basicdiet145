"use strict";

// Phase G Staging seed *importer*. No Production connection or export code.
// Input is an owner-approved, field-projected, PII-reviewed JSON bundle.
// Default action is dry-run. --apply requires explicit Stage G approval flag.
const fs = require("node:fs");
const crypto = require("node:crypto");
const STAGING_HOST = "mongodb-qxhu.railway.internal";
const STAGING_DB = "basicdiet_pos_staging_test";
const STAGING_ENV = "90700265-e775-4075-a99c-8d04508a7d98";
const STAGING_SERVICE = "9a6d629e-c9f4-4687-bf83-613011606018";

const ALLOWED = Object.freeze({
  plans: ["_id", "key", "name", "description", "daysCount", "timelineExtraDays",
    "durationDays", "currency", "gramsOptions", "skipPolicy", "freezePolicy",
    "active", "available", "isAvailable", "isActive", "isDeleted", "category", "sortOrder"],
  zones: ["_id", "name", "deliveryFeeHalala", "isActive", "sortOrder"],
  menuCategories: ["_id", "key", "name", "description", "isActive",
    "isVisible", "isAvailable", "publishedAt", "sortOrder", "ui"],
  menuProducts: ["_id", "categoryId", "catalogItemId", "key", "name",
    "description", "pricingModel", "priceHalala", "isActive", "isVisible",
    "isAvailable", "sortOrder", "ui", "versionId", "publishedAt", "imageUrl"],
  menuOptionGroups: ["_id", "key", "name", "description", "isActive",
    "isVisible", "isAvailable", "sortOrder", "publishedAt", "ui"],
  menuOptions: ["_id", "groupId", "catalogItemId", "key", "name", "description",
    "priceHalala", "nutrition", "isActive", "isVisible",
    "isAvailable", "sortOrder", "publishedAt"],
  addons: ["_id", "name", "description", "imageUrl", "priceHalala",
    "priceSar", "priceLabel", "currency", "isActive", "isArchived",
    "sortOrder", "billingMode", "kind", "type", "pricingModel",
    "billingUnit", "category", "allowanceCategory"],
  mealBuilderConfigs: ["_id", "status", "isCurrent", "versionNumber",
    "basedOnPublishedVersionId", "source", "bootstrapKey", "sections",
    "publishedAt", "displayName"],
  settings: ["_id", "key", "value", "skipAllowance", "description"],
});

const SENSITIVE_KEY = /(?:customer|client|subscriber|password|phone|e-?mail|address|location|secret|token|api.?key|auth|session|createdby|updatedby|publishedby|collectedby|userid|device|recipient|credential|billingaccount|payment)/i;
const EMAIL = /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i;
const PHONE = /(?:\+?\d[\s().-]*){10,}/;
const MAX_GROUP_SIZE = 1000;
const MAX_BYTES = 5_000_000;

function assertNonPersonal(value, path = "$", depth = 0) {
  if (depth > 16) throw new Error("Nested configuration too deep at " + path);
  if (typeof value === "string") {
    if (EMAIL.test(value) || PHONE.test(value)) {
      throw new Error("PII-like string rejected at " + path);
    }
    if (value.length > 20000) throw new Error("Excessive free-text data at " + path);
  } else if (Array.isArray(value)) {
    if (value.length > MAX_GROUP_SIZE) throw new Error("Oversized list at " + path);
    for (let i = 0; i < value.length; i++) assertNonPersonal(value[i], path + "." + i, depth + 1);
  } else if (value && typeof value === "object") {
    for (const [key, next] of Object.entries(value)) {
      if (key.startsWith("$") || key.includes(".") || SENSITIVE_KEY.test(key)) {
        throw new Error("Sensitive or unsafe field rejected at " + path + "." + key);
      }
      assertNonPersonal(next, path + "." + key, depth + 1);
    }
  } else if (value !== null && typeof value !== "number" && typeof value !== "boolean") {
    throw new Error("Unsupported field type " + path);
  }
}
function validateSeedBundle(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Expected JSON object");
  const groups = Object.keys(raw);
  if (!groups.length) throw new Error("Empty seed bundle");
  for (const group of groups) {
    if (!Object.hasOwn(ALLOWED, group)) throw new Error("Non-config collection rejected: " + group);
    const rows = raw[group];
    if (!Array.isArray(rows) || rows.length > MAX_GROUP_SIZE) {
      throw new Error("Invalid config group size: " + group);
    }
    for (const [index, row] of rows.entries()) {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        throw new Error("Invalid config document " + group + "[" + index + "]");
      }
      for (const key of Object.keys(row)) {
        if (!ALLOWED[group].includes(key)) throw new Error("Unapproved field: " + group + "." + key);
      }
      if (typeof row._id !== "string" || !/^[0-9a-f]{24}$/i.test(row._id)) {
        throw new Error("Every config row requires a stable 24-digit hex _id: " + group);
      }
      assertNonPersonal(row, "$." + group + "." + index);
    }
  }
  const canonical = JSON.stringify(raw);
  return { bundle: raw, fingerprint: crypto.createHash("sha256").update(canonical).digest("hex"),
    counts: Object.fromEntries(groups.map(group => [group, raw[group].length])) };
}

function assertStagingDatabaseEnvironment(env) {
  if (env.RAILWAY_ENVIRONMENT_ID !== STAGING_ENV
    || env.RAILWAY_SERVICE_ID !== STAGING_SERVICE
    || env.POS_STAGING_ISOLATED !== "true"
    || env.NODE_ENV === "production") {
    throw new Error("Refusing to seed outside dedicated POS Staging backend");
  }
  if (!env.POS_STAGING_MONGO_URL) throw new Error("Missing POS_STAGING_MONGO_URL");
  let uri;
  try { uri = new URL(env.POS_STAGING_MONGO_URL); }
  catch { throw new Error("Invalid POS Staging Mongo URI"); }
  if (uri.protocol !== "mongodb:" || uri.hostname !== STAGING_HOST
    || (uri.port && uri.port !== "27017") || !uri.username || !uri.password) {
    throw new Error("Refusing non-isolated Mongo host/credentials");
  }
  uri.pathname = "/" + STAGING_DB;
  uri.search = new URLSearchParams({
    authSource: "admin", replicaSet: "rs0", directConnection: "true",
  }).toString();
  uri.hash = "";
  return uri.toString();
}

async function applyApprovedBundle(bundle, uri) {
  const mongoose = require("mongoose");
  const models = {
    plans: require("../../src/models/Plan"),
    zones: require("../../src/models/Zone"),
    menuCategories: require("../../src/models/MenuCategory"),
    menuProducts: require("../../src/models/MenuProduct"),
    menuOptionGroups: require("../../src/models/MenuOptionGroup"),
    menuOptions: require("../../src/models/MenuOption"),
    addons: require("../../src/models/Addon"),
    mealBuilderConfigs: require("../../src/models/MealBuilderConfig"),
    settings: require("../../src/models/Setting"),
  };
  await mongoose.connect(uri, { dbName: STAGING_DB, serverSelectionTimeoutMS: 8000 });
  try {
    if (mongoose.connection.name !== STAGING_DB) throw new Error("Wrong connected DB name");
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    if (hello.setName !== "rs0") throw new Error("Replica set rs0 required");
    for (const [group, docs] of Object.entries(bundle)) {
      for (const doc of docs) {
        const _id = new mongoose.Types.ObjectId(doc._id);
        const { _id: ignored, ...fields } = doc;
        void ignored;
        // Only explicitly supplied business configuration; upsert by stable
        // original configuration ID to preserve menu/builder references.
        await models[group].updateOne({ _id }, { $set: fields },
          { upsert: true, runValidators: true, setDefaultsOnInsert: true });
      }
    }
    // Synthetic non-routable, unverified users, never Production customers.
    const Plan = models.plans;
    const User = require("../../src/models/User");
    const Subscription = require("../../src/models/Subscription");
    const plan = await Plan.findOne({ isActive: { $ne: false } }).sort({ daysCount: 1 });
    if (!plan) throw new Error("No seeded Plan to link synthetic QA subscription");
    for (const n of [1, 2]) {
      const phone = "+96600000000" + n;
      const qaName = "POS G3 synthetic QA " + n;
      const user = await User.findOneAndUpdate(
        { phone, name: qaName },
        { $setOnInsert: { phone, phoneE164: phone, name: qaName,
          phoneVerified: false, role: "client", isActive: true } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      // Avoid cross-system impersonation, OTP or created customer records from Production.
      const existing = await Subscription.findOne({ userId: user._id }).lean();
      if (!existing) {
        await Subscription.create({ userId: user._id, planId: plan._id,
          status: "active", totalMeals: 7, remainingMeals: 7,
          selectedGrams: 150, selectedMealsPerDay: 1, deliveryMode: "pickup",
          startDate: new Date(), endDate: new Date(Date.now() + 7 * 86400000) });
      }
    }
  } finally { await mongoose.disconnect(); }
}

async function main() {
  const args = process.argv.slice(2);
  const fileArg = args.find(item => item.startsWith("--file="));
  if (!fileArg) throw new Error("Provide --file=<approved-sanitized-config.json>");
  const input = fs.readFileSync(fileArg.slice(7));
  if (input.length > MAX_BYTES) throw new Error("Config bundle too large");
  const validated = validateSeedBundle(JSON.parse(input.toString("utf8")));
  console.log(JSON.stringify({ mode: args.includes("--apply") ? "apply" : "dry-run",
    fingerprint: validated.fingerprint, counts: validated.counts }));
  if (!args.includes("--apply")) return;
  if (process.env.POS_G0_CONFIG_EXPORT_APPROVED !== "true") {
    throw new Error("Owner has not approved this particular config import");
  }
  const uri = assertStagingDatabaseEnvironment(process.env);
  await applyApprovedBundle(validated.bundle, uri);
  console.log("Imported approved config and two synthetic test subscribers to isolated Staging.");
}
if (require.main === module) main().catch(error => {
  console.error("G0 seeder refused request:", error.message);
  process.exitCode = 1;
});
module.exports = { ALLOWED, validateSeedBundle, assertStagingDatabaseEnvironment };
