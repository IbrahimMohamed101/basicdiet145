"use strict";

// POS G0: intentionally limited to an isolated, disposable Staging G3 database.
// NEVER connect this utility to Production or to the live POS Staging database.
// The allowlisted config JSON is supplied by the owner after an explicit,
// separate Production export approval. The script cannot export any DB.
const fs = require("node:fs");
const path = require("node:path");
const mongoose = require("mongoose");
const { BSON } = require("mongodb");
const User = require("../src/models/User");
const Subscription = require("../src/models/Subscription");
const Plan = require("../src/models/Plan");
const Zone = require("../src/models/Zone");
const MenuProduct = require("../src/models/MenuProduct");
const MenuCategory = require("../src/models/MenuCategory");
const Addon = require("../src/models/Addon");
const MealBuilderConfig = require("../src/models/MealBuilderConfig");
const Setting = require("../src/models/Setting");

const ALLOWED = Object.freeze({
  plans: Plan, zones: Zone, menu_products: MenuProduct,
  menu_categories: MenuCategory, addons: Addon,
  meal_builder_configs: MealBuilderConfig, settings: Setting,
});
const BLOCKED_KEYS = /^(phone|phoneE164|email|password|passwordHash|nameOfCustomer|customerId|userId|subscriptionId|address|location|latitude|longitude|geo|ipAddress|fcmTokens|otp|token|secret|apiKey|credentials|paymentId|checkoutDraftId)$/i;
const PRIVATE_HOST = /(?:^|\.)(?:railway\.internal|internal|localhost)$/i;

function assertEnvironment(uri) {
  if (process.env.RAILWAY_ENVIRONMENT !== "staging"
    || process.env.POS_STAGING_ISOLATED !== "true"
    || process.env.ALLOW_G3_SYNTHETIC_SEED !== "YES") {
    throw new Error("Seed blocked: isolated Staging guard missing");
  }
  const parsed = new URL(uri);
  const host = parsed.hostname;
  // Do not connect to public TCP proxies, production endpoints or arbitrary hosts.
  if (!PRIVATE_HOST.test(host)) throw new Error("Seed blocked: non-private Mongo host");
  if (parsed.pathname !== "/basicdiet_pos_g3_staging_test") {
    throw new Error("Seed blocked: target database must be basicdiet_pos_g3_staging_test");
  }
  if (/proxy\.rlwy\.net|mongodb\+srv/i.test(uri)) throw new Error("Seed blocked: public Mongo URI");
}
function assertNoPii(value, location = "config") {
  if (Array.isArray(value)) {
    value.forEach((v, index) => assertNoPii(v, location + "." + index));
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (BLOCKED_KEYS.test(key)) throw new Error("Forbidden data field at " + location + "." + key);
    assertNoPii(child, location + "." + key);
  }
}
function loadConfig(file) {
  if (!file) return {};
  // Extended JSON preserves ObjectIds and dates across allowlisted config references.
  const input = BSON.EJSON.parse(fs.readFileSync(path.resolve(file), "utf8"), { relaxed: false });
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Config must be an object");
  for (const [key, rows] of Object.entries(input)) {
    if (!Object.hasOwn(ALLOWED, key)) throw new Error("Unapproved collection: " + key);
    if (!Array.isArray(rows)) throw new Error(key + " must be an array");
    for (const doc of rows) {
      if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new Error("Invalid config record");
      assertNoPii(doc, key);
    }
  }
  return input;
}
async function main() {
  const inputFile = process.argv.find(v => v.startsWith("--config="))?.slice(9);
  const apply = process.argv.includes("--apply");
  const config = loadConfig(inputFile);
  const counts = Object.fromEntries(Object.entries(config).map(([k, v]) => [k, v.length]));
  if (!apply) {
    process.stdout.write(JSON.stringify({ dryRun: true, configCounts: counts,
      syntheticUsers: 2, syntheticSubscriptions: 1, notes: "No DB connection" }) + "\n");
    return;
  }
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI required for guarded --apply");
  assertEnvironment(uri);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  try {
    if (mongoose.connection.name !== "basicdiet_pos_g3_staging_test") {
      throw new Error("DB identity changed after connect");
    }
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    if (hello.setName !== "rs0") throw new Error("Seed requires isolated rs0 transaction support");
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        for (const [key, Model] of Object.entries(ALLOWED)) {
          const rows = config[key] || [];
          if (rows.length) await Model.collection.insertMany(rows, { session, ordered: true });
        }
        const plan = await Plan.findOne({}).session(session).lean();
        if (!plan) throw new Error("No approved/test plan available. Config seed is required.");
        // Deliberately invalid synthetic numbers: no live SMS/WhatsApp destination.
        // These are TEST FIXTURES ONLY, not accounts to verify via OTP.
        const phones = ["+966000000001", "+966000000002"];
        const ids = [];
        for (let i = 0; i < phones.length; i++) {
          const existing = await User.findOne({ phone: phones[i] }).session(session);
          if (existing) throw new Error("Synthetic fixture already exists; not an idempotent data import");
          const [user] = await User.create([{
            name: "G3 synthetic customer " + (i + 1),
            phone: phones[i], phoneE164: phones[i],
            phoneVerified: false, role: "client",
            authMethods: [], authProvider: "otp", isActive: true,
          }], { session });
          ids.push(user._id);
        }
        const now = new Date();
        await Subscription.create([{
          userId: ids[0], planId: plan._id, status: "active",
          startDate: now, endDate: new Date(now.getTime() + 26 * 86400000),
          validityEndDate: new Date(now.getTime() + 26 * 86400000),
          totalMeals: 26, remainingMeals: 26,
          selectedGrams: 150, selectedMealsPerDay: 1,
        }], { session });
      });
    } finally { await session.endSession(); }
    process.stdout.write(JSON.stringify({ seeded: true, configCounts: counts,
      syntheticUsers: 2, syntheticSubscriptions: 1,
      note: "No Production customer data, no SMS, no gateway payments" }) + "\n");
  } finally { await mongoose.disconnect(); }
}
main().catch(error => {
  process.stderr.write("G0 staging seed failed: " + error.message + "\n");
  process.exitCode = 1;
});
