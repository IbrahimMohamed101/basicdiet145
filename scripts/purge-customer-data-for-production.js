#!/usr/bin/env node

"use strict";

require("dotenv").config();

const mongoose = require("mongoose");

const AccountDeletionRequest = require("../src/models/AccountDeletionRequest");
const ActivityLog = require("../src/models/ActivityLog");
const AppUser = require("../src/models/AppUser");
const CheckoutDraft = require("../src/models/CheckoutDraft");
const DashboardUser = require("../src/models/DashboardUser");
const Delivery = require("../src/models/Delivery");
const MenuAuditLog = require("../src/models/MenuAuditLog");
const NotificationLog = require("../src/models/NotificationLog");
const Order = require("../src/models/Order");
const Otp = require("../src/models/Otp");
const Payment = require("../src/models/Payment");
const PromoUsage = require("../src/models/PromoUsage");
const RefreshSession = require("../src/models/RefreshSession");
const Subscription = require("../src/models/Subscription");
const SubscriptionAuditLog = require("../src/models/SubscriptionAuditLog");
const SubscriptionDailyAddonOperation = require("../src/models/SubscriptionDailyAddonOperation");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionDayAppendOperation = require("../src/models/SubscriptionDayAppendOperation");
const SubscriptionDayMutationLock = require("../src/models/SubscriptionDayMutationLock");
const SubscriptionMealReservationLock = require("../src/models/SubscriptionMealReservationLock");
const SubscriptionPickupRequest = require("../src/models/SubscriptionPickupRequest");
const User = require("../src/models/User");
const { resolveMongoUri } = require("../src/utils/mongoUriResolver");
const {
  normalizeDashboardEmail,
  isValidEmailFormat,
  validateDashboardPassword,
  hashDashboardPassword,
} = require("../src/services/dashboardPasswordService");

const REQUIRED_PHRASE = "DELETE_ALL_CUSTOMERS_AND_ACCOUNTS";
const PROTECTED_DATABASES = new Set(["admin", "config", "local"]);

const BLOCKED_TEST_EMAILS = new Set([
  "admin@basicdiet.com",
  "manager@basicdiet.com",
  "kitchen@basicdiet.com",
  "courier@basicdiet.com",
  "pickup@basicdiet.com",
  "basicdite@outlook.sa",
]);

const BLOCKED_TEST_PASSWORDS = new Set([
  "Admin@123456",
  "Manager@123456",
  "Kitchen@123456",
  "Courier@123456",
  "Pickup@123456",
  "Client@123456",
  "BaSic@123321",
]);

// Keep catalog/configuration collections intact. Only customer, transaction,
// authentication, durable subscription-operation and account-linked audit data
// belongs in this allowlist.
const PURGE_TARGETS = Object.freeze([
  { key: "refreshSessions", label: "refresh sessions", Model: RefreshSession },
  { key: "otps", label: "OTP records", Model: Otp },
  { key: "accountDeletionRequests", label: "account deletion requests", Model: AccountDeletionRequest },
  { key: "notificationLogs", label: "notification logs", Model: NotificationLog },
  { key: "promoUsages", label: "promo-code usages", Model: PromoUsage },
  { key: "checkoutDrafts", label: "checkout drafts", Model: CheckoutDraft },
  { key: "subscriptionDayMutationLocks", label: "subscription day mutation locks", Model: SubscriptionDayMutationLock },
  { key: "subscriptionMealReservationLocks", label: "subscription meal reservation locks", Model: SubscriptionMealReservationLock },
  { key: "subscriptionDayAppendOperations", label: "subscription day append operations", Model: SubscriptionDayAppendOperation },
  { key: "subscriptionDailyAddonOperations", label: "subscription daily add-on operations", Model: SubscriptionDailyAddonOperation },
  { key: "subscriptionPickupRequests", label: "subscription pickup requests", Model: SubscriptionPickupRequest },
  { key: "subscriptionAuditLogs", label: "subscription audit logs", Model: SubscriptionAuditLog },
  { key: "subscriptionDays", label: "subscription days", Model: SubscriptionDay },
  { key: "subscriptions", label: "subscriptions", Model: Subscription },
  { key: "deliveries", label: "deliveries", Model: Delivery },
  { key: "payments", label: "payments", Model: Payment },
  { key: "orders", label: "orders", Model: Order },
  { key: "menuAuditLogs", label: "menu audit logs linked to test staff", Model: MenuAuditLog },
  { key: "activityLogs", label: "activity logs", Model: ActivityLog },
  { key: "appUsers", label: "mobile app profiles", Model: AppUser },
  { key: "users", label: "core users", Model: User },
  { key: "dashboardUsers", label: "dashboard accounts", Model: DashboardUser },
]);

function isTruthy(value) {
  return ["1", "true", "yes", "y"].includes(String(value || "").trim().toLowerCase());
}

function parseArgs(argv = process.argv.slice(2)) {
  return { execute: argv.includes("--execute") };
}

function assertDatabaseNameSafe(databaseName) {
  const normalized = String(databaseName || "").trim();
  if (!normalized) {
    throw new Error("Refusing customer-data purge because the connected database name is empty.");
  }
  if (PROTECTED_DATABASES.has(normalized.toLowerCase())) {
    throw new Error(`Refusing customer-data purge for protected MongoDB database \"${normalized}\".`);
  }
  return normalized;
}

function targetCollectionName(target) {
  const name = target?.Model?.collection?.collectionName || target?.Model?.collection?.name;
  if (!name) throw new Error(`Missing collection name for purge target \"${target?.key || "unknown"}\".`);
  return String(name);
}

function assertUniqueTargets(targets = PURGE_TARGETS) {
  const seenKeys = new Set();
  const seenCollections = new Set();
  for (const target of targets) {
    if (!target?.key || !target?.Model) throw new Error("Invalid purge target configuration.");
    if (seenKeys.has(target.key)) throw new Error(`Duplicate purge target key: ${target.key}`);
    seenKeys.add(target.key);

    const collection = targetCollectionName(target);
    if (seenCollections.has(collection)) throw new Error(`Duplicate purge target collection: ${collection}`);
    seenCollections.add(collection);
  }
  return true;
}

function validateProductionSuperadmin(env = process.env) {
  const email = normalizeDashboardEmail(env.SUPERADMIN_EMAIL);
  const password = String(env.SUPERADMIN_PASSWORD || "");
  const failures = [];

  if (!email || !isValidEmailFormat(email)) failures.push("SUPERADMIN_EMAIL must be a valid real owner email");
  if (BLOCKED_TEST_EMAILS.has(email)) failures.push("SUPERADMIN_EMAIL must not use a known demo/test account");

  const passwordValidation = validateDashboardPassword(password);
  if (!passwordValidation.ok) failures.push(`SUPERADMIN_PASSWORD: ${passwordValidation.message}`);
  if (BLOCKED_TEST_PASSWORDS.has(password)) failures.push("SUPERADMIN_PASSWORD must not use a known demo/test password");

  if (failures.length) {
    throw new Error(`Refusing customer-data purge. Invalid production superadmin:\n- ${failures.join("\n- ")}`);
  }

  return { email, password };
}

function assertExecutionConfirmed({ execute, databaseName, env = process.env }) {
  if (!execute) return null;

  const failures = [];
  if (!isTruthy(env.ALLOW_CUSTOMER_DATA_PURGE)) failures.push("ALLOW_CUSTOMER_DATA_PURGE=true");
  if (!isTruthy(env.BACKUP_CONFIRMED)) failures.push("BACKUP_CONFIRMED=true");
  if (!isTruthy(env.MAINTENANCE_MODE_CONFIRMED)) failures.push("MAINTENANCE_MODE_CONFIRMED=true");
  if (String(env.PURGE_DATABASE_NAME || "").trim() !== databaseName) {
    failures.push(`PURGE_DATABASE_NAME=${databaseName}`);
  }
  if (String(env.PURGE_CONFIRM_PHRASE || "").trim() !== REQUIRED_PHRASE) {
    failures.push(`PURGE_CONFIRM_PHRASE=${REQUIRED_PHRASE}`);
  }

  if (failures.length) {
    throw new Error(
      `Refusing customer-data purge. Missing or incorrect confirmations:\n- ${failures.join("\n- ")}`
    );
  }

  return validateProductionSuperadmin(env);
}

async function loadTargetSummary(targets = PURGE_TARGETS) {
  assertUniqueTargets(targets);
  const rows = [];
  for (const target of targets) {
    const count = await target.Model.estimatedDocumentCount();
    rows.push({
      key: target.key,
      label: target.label,
      collection: targetCollectionName(target),
      count: Number(count || 0),
    });
  }
  return rows;
}

async function loadPreservedCollectionSummary(db, targets = PURGE_TARGETS) {
  const targetCollections = new Set(targets.map(targetCollectionName));
  const collectionInfos = await db.listCollections({}, { nameOnly: true }).toArray();
  const rows = [];
  for (const info of collectionInfos) {
    if (targetCollections.has(info.name)) continue;
    const count = await db.collection(info.name).estimatedDocumentCount();
    rows.push({ name: info.name, count: Number(count || 0) });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

function comparePreservedSummaries(before = [], after = []) {
  const beforeMap = new Map(before.map((row) => [row.name, Number(row.count || 0)]));
  const afterMap = new Map(after.map((row) => [row.name, Number(row.count || 0)]));
  const names = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  const changed = [];

  for (const name of [...names].sort()) {
    const beforeCount = beforeMap.get(name) ?? 0;
    const afterCount = afterMap.get(name) ?? 0;
    if (beforeCount !== afterCount) changed.push({ name, beforeCount, afterCount });
  }
  return changed;
}

function printPlan({ databaseName, host, targets, preserved, execute }, log = console) {
  const totalDocuments = targets.reduce((sum, row) => sum + row.count, 0);
  log.log("\nCustomer/account production purge plan");
  log.log(`- host: ${host || "unknown"}`);
  log.log(`- database: ${databaseName}`);
  log.log(`- target collections: ${targets.length}`);
  log.log(`- estimated target documents: ${totalDocuments}`);
  for (const row of targets) log.log(`  - ${row.collection}: ${row.count} (${row.label})`);
  log.log(`- preserved collections: ${preserved.length}`);
  for (const row of preserved) log.log(`  - keep ${row.name}: ${row.count}`);
  log.log(`- mode: ${execute ? "EXECUTE" : "DRY RUN"}`);
  log.log("- final dashboard state: exactly one new real superadmin account");
  if (!execute) {
    log.log("\nNo data was deleted. Execution requires backup, maintenance mode, exact database confirmation and non-demo superadmin credentials.");
  }
}

async function deleteTargets(targets = PURGE_TARGETS, log = console) {
  const results = [];
  for (const target of targets) {
    const result = await target.Model.deleteMany({});
    const deletedCount = Number(result?.deletedCount || 0);
    results.push({ key: target.key, collection: targetCollectionName(target), deletedCount });
    log.log(`[purge] ${targetCollectionName(target)}: deleted ${deletedCount}`);
  }
  return results;
}

async function createProductionSuperadmin({ email, passwordHash }) {
  return DashboardUser.create({
    email,
    passwordHash,
    role: "superadmin",
    isActive: true,
    failedAttempts: 0,
    lockUntil: null,
    passwordChangedAt: new Date(),
  });
}

async function verifyPurge({ targets = PURGE_TARGETS, superadminEmail, preservedBefore, db }) {
  const targetSummary = await loadTargetSummary(targets);
  const failures = [];

  for (const row of targetSummary) {
    const expected = row.key === "dashboardUsers" ? 1 : 0;
    if (row.count !== expected) failures.push(`${row.collection}: expected ${expected}, found ${row.count}`);
  }

  const superadmin = await DashboardUser.findOne({ email: superadminEmail }).lean();
  if (!superadmin || superadmin.role !== "superadmin" || superadmin.isActive !== true) {
    failures.push("real superadmin account was not recreated correctly");
  }

  const preservedAfter = await loadPreservedCollectionSummary(db, targets);
  const preservedChanges = comparePreservedSummaries(preservedBefore, preservedAfter);
  if (preservedChanges.length) {
    failures.push(`preserved collection counts changed: ${JSON.stringify(preservedChanges)}`);
  }

  if (failures.length) {
    throw new Error(`Customer-data purge verification failed:\n- ${failures.join("\n- ")}`);
  }

  return { targetSummary, superadmin, preservedAfter };
}

async function run(options = {}) {
  const args = { ...parseArgs(options.argv), ...options };
  const uri = options.uri || resolveMongoUri();
  const targets = options.targets || PURGE_TARGETS;
  const log = options.log || console;

  assertUniqueTargets(targets);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    const databaseName = assertDatabaseNameSafe(mongoose.connection.name);
    const host = mongoose.connection.host || "unknown";
    const targetSummary = await loadTargetSummary(targets);
    const preservedBefore = await loadPreservedCollectionSummary(mongoose.connection.db, targets);

    printPlan({ databaseName, host, targets: targetSummary, preserved: preservedBefore, execute: args.execute }, log);

    const superadminCredentials = assertExecutionConfirmed({
      execute: args.execute,
      databaseName,
      env: options.env || process.env,
    });

    if (!args.execute) {
      return { executed: false, databaseName, host, targets: targetSummary, preserved: preservedBefore };
    }

    // Hash before the first deletion so invalid hashing configuration cannot
    // leave the database without a dashboard owner account.
    const passwordHash = await hashDashboardPassword(superadminCredentials.password);
    const deletionResults = await deleteTargets(targets, log);
    const superadmin = await createProductionSuperadmin({
      email: superadminCredentials.email,
      passwordHash,
    });

    const verification = await verifyPurge({
      targets,
      superadminEmail: superadminCredentials.email,
      preservedBefore,
      db: mongoose.connection.db,
    });

    log.log(`\nCustomer/account data purge completed for database \"${databaseName}\".`);
    log.log(`Production superadmin created: ${superadmin.email}`);
    log.log("Catalog, plans, add-ons, settings, pickup locations, delivery zones and promo-code definitions were preserved.");

    return {
      executed: true,
      databaseName,
      host,
      deletionResults,
      superadminId: String(superadmin._id),
      verification,
    };
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  run().catch(async (error) => {
    console.error(`[db:customer-data-purge] ${error.message}`);
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    process.exit(1);
  });
}

module.exports = {
  BLOCKED_TEST_EMAILS,
  BLOCKED_TEST_PASSWORDS,
  PROTECTED_DATABASES,
  PURGE_TARGETS,
  REQUIRED_PHRASE,
  assertDatabaseNameSafe,
  assertExecutionConfirmed,
  assertUniqueTargets,
  comparePreservedSummaries,
  createProductionSuperadmin,
  deleteTargets,
  isTruthy,
  loadPreservedCollectionSummary,
  loadTargetSummary,
  parseArgs,
  printPlan,
  run,
  targetCollectionName,
  validateProductionSuperadmin,
  verifyPurge,
};
