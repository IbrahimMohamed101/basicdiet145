"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const mongoose = require("mongoose");

const {
  validateSubscriptionStackingStagingEnv,
} = require("./validate-subscription-stacking-staging-env");
const {
  assertExtraActivationCanaryConfiguration,
  assertExtraSelectionCanaryConfiguration,
} = require("../src/services/subscription/subscriptionStackingRolloutPolicyService");
const User = require("../src/models/User");
const AppUser = require("../src/models/AppUser");
const DashboardUser = require("../src/models/DashboardUser");
const Plan = require("../src/models/Plan");
const Subscription = require("../src/models/Subscription");
const { hashAppPassword } = require("../src/services/appPasswordService");
const { hashDashboardPassword } = require("../src/services/dashboardPasswordService");

function fixtureError(code, message, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.details = details;
  return err;
}

function maskIdentifier(value) {
  const text = String(value || "");
  return text.length > 8 ? `***${text.slice(-6)}` : "***";
}

function buildFixturePhone(userId) {
  const digest = crypto.createHash("sha256").update(String(userId)).digest("hex");
  const numeric = Number.parseInt(digest.slice(0, 12), 16) % 100000000;
  return `+9665${String(numeric).padStart(8, "0")}`;
}

function randomPassword(prefix) {
  return `${prefix}!${crypto.randomBytes(18).toString("base64url")}9a`;
}

function writeGithubEnv(name, value, { mask = false } = {}) {
  const outputPath = String(process.env.GITHUB_ENV || "").trim();
  if (!outputPath) {
    throw fixtureError(
      "STAGING_FIXTURE_GITHUB_ENV_REQUIRED",
      "GITHUB_ENV is required to publish generated certification values"
    );
  }
  const text = String(value || "");
  if (mask && text) process.stdout.write(`::add-mask::${text}\n`);
  fs.appendFileSync(outputPath, `${name}<<__STACKING_CERT__\n${text}\n__STACKING_CERT__\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

async function requestJson(baseUrl, pathname, { method = "GET", body, token } = {}) {
  const response = await fetch(new URL(pathname, `${baseUrl}/`), {
    method,
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch (_err) {
    throw fixtureError("STAGING_FIXTURE_REMOTE_JSON_INVALID", "Staging response was not JSON", {
      pathname,
      status: response.status,
    });
  }
  if (!response.ok) {
    const remoteError = payload && payload.error && typeof payload.error === "object"
      ? payload.error
      : {};
    throw fixtureError("STAGING_FIXTURE_REMOTE_ERROR", "Staging fixture request failed", {
      pathname,
      status: response.status,
      remoteCode: remoteError.code || null,
    });
  }
  return payload;
}

async function upsertClientFixture(userId, password) {
  const phone = buildFixturePhone(userId);
  const collision = await User.findOne({
    _id: { $ne: userId },
    $or: [{ phone }, { phoneE164: phone }],
  }).lean();
  if (collision) {
    throw fixtureError(
      "STAGING_FIXTURE_PHONE_COLLISION",
      "Generated staging certification phone is already owned by another user"
    );
  }

  let user = await User.findById(userId);
  if (!user) user = new User({ _id: userId, phone, phoneE164: phone, role: "client" });
  const now = new Date();
  user.phone = phone;
  user.phoneE164 = phone;
  user.phoneVerified = true;
  user.passwordHash = await hashAppPassword(password);
  user.passwordSetAt = now;
  user.passwordChangedAt = now;
  user.authVersion = Number(user.authVersion || 0) + 1;
  user.forcePasswordChange = false;
  user.accountStatus = "active";
  user.resetRequestedAt = null;
  user.authProvider = "password";
  user.authMethods = ["password"];
  user.isActive = true;
  user.role = "client";
  user.name = "Stacking Certification Canary";
  user.email = undefined;
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  await user.save();

  await AppUser.findOneAndUpdate(
    { phone },
    {
      $set: {
        phone,
        coreUserId: user._id,
        fullName: user.name,
      },
      $unset: { email: "" },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return { user, phone };
}

async function loginClient(baseUrl, phone, password) {
  const payload = await requestJson(baseUrl, "/api/auth/login", {
    method: "POST",
    body: {
      phoneE164: phone,
      password,
      deviceId: "stacking-certification",
      deviceName: "GitHub Actions staging certification",
    },
  });
  const token = String(payload.accessToken || payload.token || "").trim();
  if (!token) {
    throw fixtureError(
      "STAGING_FIXTURE_CLIENT_TOKEN_MISSING",
      "Staging client login did not return an app access token"
    );
  }
  return token;
}

async function assertExactRuntime(baseUrl, clientToken, expectedSha) {
  const payload = await requestJson(baseUrl, "/api/subscriptions/stacking/readiness", {
    token: clientToken,
  });
  const readiness = payload && payload.data && typeof payload.data === "object"
    ? payload.data
    : payload;
  const actualSha = String(
    readiness && readiness.deployment && readiness.deployment.commitSha || ""
  ).trim();
  if (!actualSha || !expectedSha || actualSha !== expectedSha) {
    throw fixtureError(
      "STAGING_FIXTURE_DEPLOYMENT_SHA_MISMATCH",
      "Staging runtime commit does not match the certification candidate",
      {
        expected: expectedSha || null,
        actual: actualSha || null,
      }
    );
  }
  if (
    !readiness.certification
    || readiness.certification.readProbeReady !== true
    || readiness.certification.baseMealCanaryReady !== true
    || readiness.certification.extraEntitlementCanaryReady !== true
  ) {
    throw fixtureError(
      "STAGING_FIXTURE_CANARY_NOT_READY",
      "Staging canary readiness is not fully enabled",
      {
        blockedReasons: readiness.certification && readiness.certification.blockedReasons || [],
        extraBlockedReasons: readiness.certification && readiness.certification.extraEntitlementBlockedReasons || [],
      }
    );
  }
  return readiness;
}

async function ensureParentSubscription(userId) {
  const key = `stacking-cert-parent-${String(userId).slice(-12)}`;
  let plan = await Plan.findOne({ key });
  const planFields = {
    key,
    name: { ar: "باقة اعتماد Stacking", en: "Stacking Certification Base" },
    description: { ar: "باقة Staging للاعتماد فقط", en: "Isolated staging certification fixture" },
    daysCount: 26,
    durationDays: 26,
    currency: "SAR",
    gramsOptions: [{
      grams: 200,
      mealsOptions: [{
        mealsPerDay: 3,
        priceHalala: 10000,
        compareAtHalala: 10000,
        isActive: true,
      }],
      isActive: true,
    }],
    active: true,
    available: true,
    isAvailable: true,
    isActive: true,
    isDeleted: false,
  };
  if (!plan) plan = new Plan(planFields);
  else Object.assign(plan, planFields);
  await plan.save();

  let subscription = await Subscription.findOne({ userId, status: "active" });
  if (!subscription) {
    const now = new Date();
    const startDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const endDate = new Date(now.getTime() + 25 * 24 * 60 * 60 * 1000);
    subscription = await Subscription.create({
      userId,
      planId: plan._id,
      status: "active",
      startDate,
      endDate,
      validityEndDate: endDate,
      totalMeals: 78,
      remainingMeals: 20,
      selectedMealsPerDay: 3,
      selectedGrams: 200,
      deliveryMode: "pickup",
      pickupLocationId: "stacking-certification-branch",
      deliveryWindow: "13:00-15:00",
      deliverySlot: {
        type: "pickup",
        window: "13:00-15:00",
        slotId: "stacking-certification-slot",
        label: "13:00-15:00",
      },
      checkoutCurrency: "SAR",
    });
  }
  return subscription;
}

async function upsertDashboardFixture(password) {
  const email = "stacking-cert-kitchen@staging.invalid";
  let user = await DashboardUser.findOne({ email });
  if (!user) {
    user = new DashboardUser({
      email,
      passwordHash: await hashDashboardPassword(password),
      role: "kitchen",
      isActive: true,
    });
  } else {
    user.passwordHash = await hashDashboardPassword(password);
    user.role = "kitchen";
    user.isActive = true;
    user.failedAttempts = 0;
    user.lockUntil = null;
  }
  await user.save();
  return { user, email };
}

async function loginDashboard(baseUrl, email, password) {
  const payload = await requestJson(baseUrl, "/api/dashboard/auth/login", {
    method: "POST",
    body: { email, password },
  });
  const token = String(payload.token || payload.accessToken || "").trim();
  if (!token) {
    throw fixtureError(
      "STAGING_FIXTURE_DASHBOARD_TOKEN_MISSING",
      "Staging dashboard login did not return an access token"
    );
  }
  return token;
}

async function bootstrapStagingFixture(env = process.env) {
  const safety = validateSubscriptionStackingStagingEnv(env);
  assertExtraActivationCanaryConfiguration(env);
  assertExtraSelectionCanaryConfiguration(env);

  if (!safety.database || String(safety.database.databaseName).toLowerCase() !== "basicdiet_staging") {
    throw fixtureError(
      "STAGING_FIXTURE_DATABASE_MISMATCH",
      "Certification fixture may only use basicdiet_staging"
    );
  }
  const userId = String(
    env.STAGING_CERTIFICATION_USER_ID || safety.rolloutUserId || ""
  ).trim();
  if (!mongoose.isValidObjectId(userId)) {
    throw fixtureError(
      "STAGING_FIXTURE_USER_ID_INVALID",
      "Certification fixture requires one valid staging canary user id"
    );
  }
  if (userId !== safety.rolloutUserId) {
    throw fixtureError(
      "STAGING_FIXTURE_USER_ALLOWLIST_MISMATCH",
      "Certification fixture user must equal the exact stacking rollout user"
    );
  }

  const expectedSha = String(env.STAGING_EXPECTED_DEPLOYMENT_COMMIT_SHA || "").trim();
  if (!expectedSha) {
    throw fixtureError(
      "STAGING_FIXTURE_EXPECTED_SHA_REQUIRED",
      "Expected deployment commit SHA is required"
    );
  }

  await mongoose.connect(env.MONGODB_URI || env.MONGO_URI, { autoIndex: false });
  try {
    const clientPassword = randomPassword("StackingClient");
    const client = await upsertClientFixture(userId, clientPassword);
    const clientToken = await loginClient(safety.baseUrl, client.phone, clientPassword);

    await assertExactRuntime(safety.baseUrl, clientToken, expectedSha);

    const parent = await ensureParentSubscription(userId);
    const dashboardPassword = randomPassword("StackingKitchen");
    const dashboard = await upsertDashboardFixture(dashboardPassword);
    const dashboardToken = await loginDashboard(
      safety.baseUrl,
      dashboard.email,
      dashboardPassword
    );

    writeGithubEnv("STAGING_CLIENT_TOKEN", clientToken, { mask: true });
    writeGithubEnv("STAGING_DASHBOARD_TOKEN", dashboardToken, { mask: true });
    writeGithubEnv("STAGING_SUBSCRIPTION_ID", String(parent._id));

    return {
      ok: true,
      database: safety.database.fingerprint,
      userId: maskIdentifier(userId),
      subscriptionId: maskIdentifier(parent._id),
      dashboardUserId: maskIdentifier(dashboard.user._id),
      deploymentCommitSha: expectedSha,
      tokensGeneratedThroughPublicLogin: true,
    };
  } finally {
    await mongoose.disconnect();
  }
}

async function runCli() {
  try {
    const result = await bootstrapStagingFixture(process.env);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (err) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: err && err.code || "STAGING_FIXTURE_BOOTSTRAP_FAILED",
      message: err && err.message || "Failed to bootstrap isolated staging certification fixture",
      details: err && err.details || {},
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) runCli();

module.exports = {
  bootstrapStagingFixture,
  buildFixturePhone,
  maskIdentifier,
  randomPassword,
  writeGithubEnv,
};
