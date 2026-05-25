#!/usr/bin/env node

require("dotenv").config();

const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

const DashboardUser = require("../src/models/DashboardUser");
const User = require("../src/models/User");
const AppUser = require("../src/models/AppUser");
const { DASHBOARD_ROLES } = require("../src/constants/dashboardRoles");
const {
  normalizeDashboardEmail,
  buildDashboardEmailQuery,
  isValidEmailFormat,
  validateDashboardPassword,
  hashDashboardPassword,
  compareDashboardPassword,
} = require("../src/services/dashboardPasswordService");
const {
  issueDashboardAccessToken,
  DASHBOARD_JWT_SECRET,
} = require("../src/services/dashboardTokenService");
const {
  assertValidPhoneE164,
} = require("../src/services/otpService");
const {
  validateAppPassword,
  hashAppPassword,
  compareAppPassword,
} = require("../src/services/appPasswordService");
const {
  issueAppAccessToken,
  JWT_ACCESS_SECRET,
} = require("../src/services/appTokenService");

const DASHBOARD_ACCOUNTS = Object.freeze([
  {
    label: "Super Admin",
    email: "admin@basicdiet.com",
    password: "Admin@123456",
    role: "superadmin",
  },
  {
    label: "Admin",
    email: "manager@basicdiet.com",
    password: "Manager@123456",
    role: "admin",
  },
  {
    label: "Kitchen",
    email: "kitchen@basicdiet.com",
    password: "Kitchen@123456",
    role: "kitchen",
  },
  {
    label: "Courier",
    email: "courier@basicdiet.com",
    password: "Courier@123456",
    role: "courier",
  },
  {
    label: "Pickup",
    email: "pickup@basicdiet.com",
    password: "Pickup@123456",
    role: "cashier",
    requestedRole: "pickup",
  },
]);

const APP_ACCOUNTS = Object.freeze([
  {
    label: "Test Client 1",
    phoneE164: "+201000000001",
    password: "Client@123456",
    fullName: "Test Client One",
  },
  {
    label: "Test Client 2",
    phoneE164: "+201000000002",
    password: "Client@123456",
    fullName: "Test Client Two",
  },
]);

const DASHBOARD_ROLE_CHECKS = Object.freeze({
  superadmin: ["admin"],
  admin: ["admin"],
  kitchen: ["kitchen", "admin"],
  courier: ["courier", "admin"],
  cashier: ["admin", "cashier"],
});

function maskMongoUri(uri) {
  try {
    const parsed = new URL(uri);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch (_err) {
    return "invalid-uri";
  }
}

function getEnvironmentName() {
  return process.env.NODE_ENV || "development";
}

function assertProductionAllowed() {
  const envName = getEnvironmentName();
  console.log(`[accounts-bootstrap] Environment: ${envName}`);
  if (envName === "production" && process.env.ALLOW_ACCOUNT_BOOTSTRAP !== "true") {
    throw new Error(
      "Refusing to run in production. Set ALLOW_ACCOUNT_BOOTSTRAP=true for this one-time bootstrap."
    );
  }
}

async function connectSafely() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("Missing MongoDB connection string (set MONGO_URI or MONGODB_URI)");
  }

  console.log(`[accounts-bootstrap] MongoDB: ${maskMongoUri(uri)}`);

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
  });
}

function validateDashboardAccount(account) {
  const email = normalizeDashboardEmail(account.email);
  if (!isValidEmailFormat(email)) {
    throw new Error(`Invalid dashboard email for ${account.label}`);
  }
  if (!DASHBOARD_ROLES.includes(account.role)) {
    throw new Error(`Invalid dashboard role for ${account.label}: ${account.role}`);
  }
  const passwordValidation = validateDashboardPassword(account.password);
  if (!passwordValidation.ok) {
    throw new Error(`Invalid dashboard password for ${account.label}: ${passwordValidation.message}`);
  }
  return { ...account, email };
}

function validateAppAccount(account) {
  const phoneE164 = assertValidPhoneE164(account.phoneE164);
  const passwordValidation = validateAppPassword(account.password);
  if (!passwordValidation.ok) {
    throw new Error(`Invalid app password for ${account.label}: ${passwordValidation.message}`);
  }
  const fullName = String(account.fullName || "").trim();
  if (!fullName) {
    throw new Error(`Missing fullName for ${account.label}`);
  }
  return { ...account, phoneE164, fullName };
}

async function createDashboardAccount(account) {
  const safeAccount = validateDashboardAccount(account);
  const existing = await DashboardUser.findOne(buildDashboardEmailQuery(safeAccount.email));
  if (existing) {
    return {
      type: "dashboard",
      status: "skipped",
      label: safeAccount.label,
      email: safeAccount.email,
      role: existing.role,
      reason: "already exists",
      user: existing,
      password: safeAccount.password,
    };
  }

  const passwordHash = await hashDashboardPassword(safeAccount.password);
  const created = await DashboardUser.create({
    email: safeAccount.email,
    passwordHash,
    role: safeAccount.role,
    isActive: true,
    failedAttempts: 0,
    lockUntil: null,
    passwordChangedAt: new Date(),
  });

  return {
    type: "dashboard",
    status: "created",
    label: safeAccount.label,
    email: created.email,
    role: created.role,
    requestedRole: safeAccount.requestedRole,
    user: created,
    password: safeAccount.password,
  };
}

async function createAppAccount(account) {
  const safeAccount = validateAppAccount(account);
  const [existingCoreUser, existingAppUser] = await Promise.all([
    User.findOne({
      role: "client",
      $or: [{ phoneE164: safeAccount.phoneE164 }, { phone: safeAccount.phoneE164 }],
    }),
    AppUser.findOne({ phone: safeAccount.phoneE164 }),
  ]);

  if (existingCoreUser || existingAppUser) {
    return {
      type: "mobile",
      status: "skipped",
      label: safeAccount.label,
      phoneE164: safeAccount.phoneE164,
      reason: existingCoreUser ? "core user already exists" : "app user already exists",
      user: existingCoreUser,
      appUser: existingAppUser,
      password: safeAccount.password,
    };
  }

  const passwordHash = await hashAppPassword(safeAccount.password);
  const coreUser = await User.create({
    phone: safeAccount.phoneE164,
    phoneE164: safeAccount.phoneE164,
    phoneVerified: true,
    passwordHash,
    name: safeAccount.fullName,
    role: "client",
    isActive: true,
  });

  const appUser = await AppUser.create({
    phone: safeAccount.phoneE164,
    fullName: safeAccount.fullName,
    coreUserId: coreUser._id,
  });

  return {
    type: "mobile",
    status: "created",
    label: safeAccount.label,
    phoneE164: safeAccount.phoneE164,
    role: "client",
    user: coreUser,
    appUser,
    password: safeAccount.password,
  };
}

async function verifyDashboardLoginCompatibility(result) {
  if (!result.user) {
    return { ok: false, message: "no dashboard user available for verification" };
  }
  if (result.user.isActive === false) {
    return { ok: false, message: "dashboard user is inactive" };
  }
  const passwordMatches = await compareDashboardPassword(result.password, result.user.passwordHash);
  if (!passwordMatches) {
    return { ok: false, message: "dashboard password does not match stored hash" };
  }
  if (!DASHBOARD_JWT_SECRET) {
    return { ok: false, message: "DASHBOARD_JWT_SECRET is not configured" };
  }

  const token = issueDashboardAccessToken(result.user);
  const decoded = jwt.verify(token, DASHBOARD_JWT_SECRET);
  const allowedRoles = DASHBOARD_ROLE_CHECKS[result.user.role] || [];
  const roleAllowedByMiddleware = result.user.role === "superadmin"
    || allowedRoles.includes(result.user.role);

  if (decoded.tokenType !== "dashboard_access" || String(decoded.userId) !== String(result.user._id)) {
    return { ok: false, message: "dashboard token payload is incompatible" };
  }
  if (!roleAllowedByMiddleware) {
    return { ok: false, message: "dashboard role is not compatible with expected role middleware" };
  }
  return { ok: true, message: "password, dashboard JWT, and role are compatible" };
}

async function verifyAppLoginCompatibility(result) {
  if (!result.user) {
    return { ok: false, message: "existing app account was not verified to avoid modifying it" };
  }
  if (result.user.isActive === false) {
    return { ok: false, message: "app user is inactive" };
  }
  if (result.user.role !== "client") {
    return { ok: false, message: "app user role is not client" };
  }
  if (result.user.phoneVerified !== true) {
    return { ok: false, message: "app user phone is not verified" };
  }
  const passwordMatches = await compareAppPassword(result.password, result.user.passwordHash);
  if (!passwordMatches) {
    return { ok: false, message: "app password does not match stored hash" };
  }

  const token = issueAppAccessToken(result.user);
  const decoded = jwt.verify(token, JWT_ACCESS_SECRET);
  if (
    decoded.tokenType !== "app_access"
    || decoded.role !== "client"
    || String(decoded.userId) !== String(result.user._id)
  ) {
    return { ok: false, message: "app token payload is incompatible" };
  }
  return { ok: true, message: "password, app JWT, and client role are compatible" };
}

function printAccountResult(result) {
  if (result.type === "dashboard") {
    const requestedRole = result.requestedRole ? ` requestedRole=${result.requestedRole}` : "";
    console.log(
      `[${result.status}] dashboard label="${result.label}" email=${result.email} role=${result.role}${requestedRole}`
    );
    return;
  }
  console.log(
    `[${result.status}] mobile label="${result.label}" phone=${result.phoneE164} role=${result.role || "client"} reason=${result.reason || "created"}`
  );
}

function printVerification(result, verification) {
  const identity = result.type === "dashboard"
    ? `dashboard ${result.email}`
    : `mobile ${result.phoneE164}`;
  const marker = verification.ok ? "ok" : "warning";
  console.log(`[verify:${marker}] ${identity}: ${verification.message}`);
}

async function bootstrapDefaultAccounts() {
  assertProductionAllowed();
  await connectSafely();

  const results = [];
  for (const account of DASHBOARD_ACCOUNTS) {
    const result = await createDashboardAccount(account);
    results.push(result);
    printAccountResult(result);
  }

  for (const account of APP_ACCOUNTS) {
    const result = await createAppAccount(account);
    results.push(result);
    printAccountResult(result);
  }

  for (const result of results) {
    const verification = result.type === "dashboard"
      ? await verifyDashboardLoginCompatibility(result)
      : await verifyAppLoginCompatibility(result);
    result.verification = verification;
    printVerification(result, verification);
  }

  const created = results.filter((item) => item.status === "created");
  const skipped = results.filter((item) => item.status === "skipped");
  const failedVerification = results.filter((item) => !item.verification || !item.verification.ok);

  console.log("[summary] created=%d skipped=%d verificationWarnings=%d", created.length, skipped.length, failedVerification.length);
  return { results, created, skipped, failedVerification };
}

async function main() {
  try {
    const summary = await bootstrapDefaultAccounts();
    if (summary.failedVerification.length > 0) {
      console.log("[accounts-bootstrap] Completed with verification warnings. Existing accounts were not modified.");
    }
    process.exitCode = 0;
  } catch (err) {
    console.error(`[accounts-bootstrap] ${err.message}`);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  DASHBOARD_ACCOUNTS,
  APP_ACCOUNTS,
  bootstrapDefaultAccounts,
  createDashboardAccount,
  createAppAccount,
  verifyDashboardLoginCompatibility,
  verifyAppLoginCompatibility,
};
