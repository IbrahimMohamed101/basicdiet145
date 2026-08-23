"use strict";

const mongoose = require("mongoose");
const ActivityLog = require("../../models/ActivityLog");
const AppUser = require("../../models/AppUser");
const EmailOtpChallenge = require("../../models/EmailOtpChallenge");
const Otp = require("../../models/Otp");
const Plan = require("../../models/Plan");
const RefreshSession = require("../../models/RefreshSession");
const Subscription = require("../../models/Subscription");
const User = require("../../models/User");
const { logger } = require("../../utils/logger");
const { startSafeSession } = require("../../utils/mongoTransactionSupport");
const { assertValidPhoneE164 } = require("../otpService");

const EDITABLE_FIELDS = new Set([
  "fullName",
  "phone",
  "email",
  "isActive",
  "deliveryAddress",
  "reason",
]);
const ADDRESS_TEXT_LIMITS = {
  line1: 250,
  line2: 250,
  city: 100,
  district: 150,
  street: 150,
  building: 80,
  apartment: 80,
  notes: 500,
};

function customerManagementError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function normalizeEmail(value) {
  if (value === undefined) return undefined;
  if (value === null || String(value).trim() === "") return null;

  const normalized = String(value).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254) {
    throw customerManagementError(400, "INVALID_EMAIL", "email must be a valid email address");
  }
  return normalized;
}

function normalizeFullName(value) {
  if (value === undefined) return undefined;
  if (value === null || String(value).trim() === "") return null;

  const normalized = String(value).trim().replace(/\s+/g, " ");
  if (normalized.length < 2 || normalized.length > 120) {
    throw customerManagementError(400, "INVALID_NAME", "fullName must contain between 2 and 120 characters");
  }
  return normalized;
}

function addressSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const snapshot = {};
  for (const key of Object.keys(ADDRESS_TEXT_LIMITS)) {
    if (value[key] !== undefined && value[key] !== null && String(value[key]).trim()) {
      snapshot[key] = String(value[key]).trim();
    }
  }
  for (const key of ["lat", "lng"]) {
    const numeric = Number(value[key]);
    if (value[key] !== undefined && value[key] !== null && Number.isFinite(numeric)) {
      snapshot[key] = numeric;
    }
  }
  return Object.keys(snapshot).length ? snapshot : null;
}

function normalizeDeliveryAddress(value, currentAddress) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw customerManagementError(400, "INVALID_ADDRESS", "deliveryAddress must be an object");
  }

  const normalized = addressSnapshot(currentAddress) || {};
  const unknownKeys = Object.keys(value).filter(
    (key) => !Object.prototype.hasOwnProperty.call(ADDRESS_TEXT_LIMITS, key) && !["lat", "lng"].includes(key)
  );
  if (unknownKeys.length) {
    throw customerManagementError(400, "INVALID_ADDRESS", `Unsupported address fields: ${unknownKeys.join(", ")}`);
  }

  for (const [key, maxLength] of Object.entries(ADDRESS_TEXT_LIMITS)) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const text = value[key] === null ? "" : String(value[key]).trim();
    if (text.length > maxLength) {
      throw customerManagementError(400, "INVALID_ADDRESS", `${key} is too long`);
    }
    if (text) normalized[key] = text;
    else delete normalized[key];
  }

  for (const key of ["lat", "lng"]) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    if (value[key] === null || value[key] === "") {
      delete normalized[key];
      continue;
    }
    const numeric = Number(value[key]);
    if (!Number.isFinite(numeric)) {
      throw customerManagementError(400, "INVALID_ADDRESS", `${key} must be a number`);
    }
    if ((key === "lat" && (numeric < -90 || numeric > 90)) || (key === "lng" && (numeric < -180 || numeric > 180))) {
      throw customerManagementError(400, "INVALID_ADDRESS", `${key} is outside the valid range`);
    }
    normalized[key] = numeric;
  }

  if (!normalized.line1 && !normalized.street && !normalized.district) {
    throw customerManagementError(
      400,
      "INVALID_ADDRESS",
      "deliveryAddress must include line1, street, or district"
    );
  }
  return normalized;
}

function localizedSnapshot(value) {
  if (!value) return null;
  if (typeof value === "string") return { ar: value, en: value };
  return {
    ar: String(value.ar || value.en || ""),
    en: String(value.en || value.ar || ""),
  };
}

function serializeMealCompensation(row) {
  return {
    id: row._id ? String(row._id) : null,
    idempotencyKey: row.idempotencyKey,
    quantity: Number(row.quantity || 0),
    reason: row.reason || "",
    byUserId: row.byUserId ? String(row.byUserId) : null,
    byRole: row.byRole || "superadmin",
    before: {
      totalMeals: Number(row.beforeTotalMeals || 0),
      remainingMeals: Number(row.beforeRemainingMeals || 0),
    },
    after: {
      totalMeals: Number(row.afterTotalMeals || 0),
      remainingMeals: Number(row.afterRemainingMeals || 0),
    },
    createdAt: row.createdAt || null,
  };
}

function serializeActiveSubscription(subscription, plan = null) {
  if (!subscription) return null;
  const premiumRemainingMeals = (subscription.premiumBalance || [])
    .reduce((sum, row) => sum + Math.max(0, Number(row.remainingQty || 0)), 0);
  const remainingMeals = Math.max(0, Number(subscription.remainingMeals || 0));
  const totalMeals = Math.max(0, Number(subscription.totalMeals || 0));
  const compensationHistory = [...(subscription.adminMealCompensations || [])]
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, 20)
    .map(serializeMealCompensation);
  return {
    id: String(subscription._id),
    displayId: `SUB-${String(subscription._id).slice(-6).toUpperCase()}`,
    status: subscription.status,
    planId: subscription.planId ? String(subscription.planId) : null,
    planName: localizedSnapshot(plan && plan.name),
    startDate: subscription.startDate || null,
    endDate: subscription.endDate || null,
    validityEndDate: subscription.validityEndDate || subscription.endDate || null,
    deliveryMode: subscription.deliveryMode,
    deliveryAddress: addressSnapshot(subscription.deliveryAddress),
    selectedMealsPerDay: Number(subscription.selectedMealsPerDay || 0),
    selectedGrams: Number(subscription.selectedGrams || 0),
    balances: {
      totalMeals,
      remainingMeals,
      remainingRegularMeals: Math.max(0, remainingMeals - premiumRemainingMeals),
      remainingPremiumMeals: premiumRemainingMeals,
      consumedMeals: Math.max(0, Number(
        subscription.consumedMeals === undefined
          ? totalMeals - remainingMeals
          : subscription.consumedMeals
      )),
      reservedMeals: Math.max(0, Number(subscription.reservedMeals || 0)),
      forfeitedMeals: Math.max(0, Number(subscription.forfeitedMeals || 0)),
      compensatedMealsTotal: Math.max(0, Number(subscription.compensatedMealsTotal || 0)),
    },
    compensationHistory,
  };
}

function serializeCustomer({ user, appUser, activeSubscription, plan = null }) {
  return {
    id: String(user._id),
    coreUserId: String(user._id),
    appUserId: appUser ? String(appUser._id) : null,
    fullName: user.name || (appUser && appUser.fullName) || null,
    phone: user.phoneE164 || user.phone || (appUser && appUser.phone) || null,
    phoneE164: user.phoneE164 || user.phone || (appUser && appUser.phone) || null,
    email: user.email || (appUser && appUser.email) || null,
    isActive: user.isActive !== false,
    activeSubscription: serializeActiveSubscription(activeSubscription, plan),
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null,
  };
}

async function findManagedCustomer(id, { session = null, lean = true } = {}) {
  if (!mongoose.isValidObjectId(id)) {
    throw customerManagementError(400, "INVALID_ID", "Customer id is invalid");
  }

  let userQuery = User.findOne({ _id: id, role: "client" });
  if (session) userQuery = userQuery.session(session);
  let user = lean ? await userQuery.lean() : await userQuery;
  let appUser = null;

  if (!user) {
    let appUserQuery = AppUser.findById(id);
    if (session) appUserQuery = appUserQuery.session(session);
    appUser = lean ? await appUserQuery.lean() : await appUserQuery;
    if (!appUser) return null;

    const coreFilter = appUser.coreUserId
      ? { _id: appUser.coreUserId, role: "client" }
      : { phone: appUser.phone, role: "client" };
    userQuery = User.findOne(coreFilter);
    if (session) userQuery = userQuery.session(session);
    user = lean ? await userQuery.lean() : await userQuery;
    if (!user) return null;
  }

  if (!appUser) {
    let appUserQuery = AppUser.findOne({
      $or: [{ coreUserId: user._id }, { phone: user.phoneE164 || user.phone }],
    });
    if (session) appUserQuery = appUserQuery.session(session);
    appUser = lean ? await appUserQuery.lean() : await appUserQuery;
  }

  return { user, appUser };
}

async function findActiveSubscription(userId, { session = null, lean = true } = {}) {
  let query = Subscription.findOne({ userId, status: "active" }).sort({ createdAt: -1 });
  if (session) query = query.session(session);
  return lean ? query.lean() : query;
}

async function findPlan(planId, { session = null } = {}) {
  if (!planId) return null;
  let query = Plan.findById(planId).select("_id name");
  if (session) query = query.session(session);
  return query.lean();
}

async function getCustomerManagementProfile(id) {
  const managed = await findManagedCustomer(id);
  if (!managed) {
    throw customerManagementError(404, "NOT_FOUND", "Customer account was not found");
  }
  const activeSubscription = await findActiveSubscription(managed.user._id);
  const plan = activeSubscription ? await findPlan(activeSubscription.planId) : null;
  return serializeCustomer({ ...managed, activeSubscription, plan });
}

function normalizeCompensationPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw customerManagementError(400, "INVALID", "Request body must be an object");
  }
  const quantity = Number(payload.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
    throw customerManagementError(400, "INVALID_COMPENSATION_QUANTITY", "quantity must be an integer between 1 and 100");
  }
  const reason = String(payload.reason || "").trim();
  if (reason.length < 3 || reason.length > 500) {
    throw customerManagementError(400, "REASON_REQUIRED", "A reason between 3 and 500 characters is required");
  }
  const idempotencyKey = String(payload.idempotencyKey || "").trim();
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(idempotencyKey)) {
    throw customerManagementError(400, "INVALID_IDEMPOTENCY_KEY", "A valid idempotencyKey is required");
  }
  return { quantity, reason, idempotencyKey };
}

async function grantCustomerMealCompensation({ id, payload, actorId, actorRole }) {
  if (actorRole !== "superadmin") {
    throw customerManagementError(403, "FORBIDDEN", "Only superadmin may grant meal compensation");
  }
  const input = normalizeCompensationPayload(payload);
  const managed = await findManagedCustomer(id);
  if (!managed) {
    throw customerManagementError(404, "NOT_FOUND", "Customer account was not found");
  }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const subscription = await findActiveSubscription(managed.user._id);
    if (!subscription) {
      throw customerManagementError(422, "ACTIVE_SUBSCRIPTION_REQUIRED", "Meal compensation requires an active subscription");
    }
    const replayed = (subscription.adminMealCompensations || [])
      .find((row) => row.idempotencyKey === input.idempotencyKey);
    if (replayed) {
      const plan = await findPlan(subscription.planId);
      return {
        customer: serializeCustomer({ ...managed, activeSubscription: subscription, plan }),
        compensation: serializeMealCompensation(replayed),
        replayed: true,
      };
    }

    const beforeTotalMeals = Math.max(0, Number(subscription.totalMeals || 0));
    const beforeRemainingMeals = Math.max(0, Number(subscription.remainingMeals || 0));
    const compensation = {
      _id: new mongoose.Types.ObjectId(),
      idempotencyKey: input.idempotencyKey,
      quantity: input.quantity,
      reason: input.reason,
      byUserId: actorId,
      byRole: actorRole,
      beforeTotalMeals,
      beforeRemainingMeals,
      afterTotalMeals: beforeTotalMeals + input.quantity,
      afterRemainingMeals: beforeRemainingMeals + input.quantity,
      createdAt: new Date(),
    };
    const updated = await Subscription.findOneAndUpdate(
      {
        _id: subscription._id,
        status: "active",
        totalMeals: beforeTotalMeals,
        remainingMeals: beforeRemainingMeals,
        "adminMealCompensations.idempotencyKey": { $ne: input.idempotencyKey },
      },
      {
        $inc: {
          totalMeals: input.quantity,
          remainingMeals: input.quantity,
          compensatedMealsTotal: input.quantity,
          __v: 1,
        },
        $push: { adminMealCompensations: compensation },
      },
      { new: true }
    ).lean();

    if (!updated) continue;

    try {
      await ActivityLog.create({
        entityType: "subscription",
        entityId: updated._id,
        action: "subscription_meal_compensation_granted_by_superadmin",
        byUserId: actorId,
        byRole: actorRole,
        meta: {
          customerId: String(managed.user._id),
          idempotencyKey: input.idempotencyKey,
          quantity: input.quantity,
          reason: input.reason,
          before: {
            totalMeals: beforeTotalMeals,
            remainingMeals: beforeRemainingMeals,
          },
          after: {
            totalMeals: compensation.afterTotalMeals,
            remainingMeals: compensation.afterRemainingMeals,
          },
          source: "dashboard_customer_management",
        },
      });
    } catch (error) {
      logger.error("customer meal compensation activity log failed", {
        subscriptionId: String(updated._id),
        idempotencyKey: input.idempotencyKey,
        error: error.message,
      });
    }

    const plan = await findPlan(updated.planId);
    return {
      customer: serializeCustomer({ ...managed, activeSubscription: updated, plan }),
      compensation: serializeMealCompensation(compensation),
      replayed: false,
    };
  }

  throw customerManagementError(409, "BALANCE_CHANGED", "Subscription balance changed; refresh and try again");
}

async function assertNoIdentityConflict({ userId, appUserId, phone, email, session }) {
  const userChecks = [];
  const appUserChecks = [];

  if (phone) {
    userChecks.push({ phone }, { phoneE164: phone });
    appUserChecks.push({ phone });
  }
  if (email) {
    userChecks.push({ email });
    appUserChecks.push({ email });
  }
  if (!userChecks.length) return;

  const [userConflict, appUserConflict] = await Promise.all([
    User.findOne({ _id: { $ne: userId }, $or: userChecks }).session(session).lean(),
    AppUser.findOne({
      ...(appUserId ? { _id: { $ne: appUserId } } : {}),
      coreUserId: { $ne: userId },
      $or: appUserChecks,
    }).session(session).lean(),
  ]);

  if (userConflict || appUserConflict) {
    throw customerManagementError(
      409,
      "CUSTOMER_IDENTITY_CONFLICT",
      "Another customer already uses this phone number or email address"
    );
  }
}

function changedFields(before, after) {
  return Object.keys(after).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}

async function updateCustomerManagementProfile({ id, payload, actorId, actorRole }) {
  if (actorRole !== "superadmin") {
    throw customerManagementError(403, "FORBIDDEN", "Only superadmin may update customer identity data");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw customerManagementError(400, "INVALID", "Request body must be an object");
  }

  const unknownFields = Object.keys(payload).filter((key) => !EDITABLE_FIELDS.has(key));
  if (unknownFields.length) {
    throw customerManagementError(400, "UNSUPPORTED_FIELDS", `Unsupported fields: ${unknownFields.join(", ")}`);
  }
  const hasEditableField = ["fullName", "phone", "email", "isActive", "deliveryAddress"]
    .some((field) => Object.prototype.hasOwnProperty.call(payload, field));
  if (!hasEditableField) {
    throw customerManagementError(400, "NO_CHANGES", "At least one editable field is required");
  }

  const reason = String(payload.reason || "").trim();
  if (reason.length < 3 || reason.length > 500) {
    throw customerManagementError(400, "REASON_REQUIRED", "A reason between 3 and 500 characters is required");
  }

  const normalizedFullName = normalizeFullName(payload.fullName);
  const normalizedEmail = normalizeEmail(payload.email);
  const normalizedPhone = payload.phone === undefined ? undefined : assertValidPhoneE164(payload.phone);
  if (payload.isActive !== undefined && typeof payload.isActive !== "boolean") {
    throw customerManagementError(400, "INVALID_STATUS", "isActive must be a boolean");
  }

  const session = await startSafeSession();
  try {
    if (!session.supportsTransactions) {
      throw customerManagementError(
        503,
        "TRANSACTION_REQUIRED",
        "Customer identity updates require MongoDB transaction support"
      );
    }

    let result;
    await session.withTransaction(async () => {
      const managed = await findManagedCustomer(id, { session, lean: false });
      if (!managed) {
        throw customerManagementError(404, "NOT_FOUND", "Customer account was not found");
      }

      const user = managed.user;
      let appUser = managed.appUser;
      const activeSubscription = await findActiveSubscription(user._id, { session, lean: false });
      const plan = activeSubscription ? await findPlan(activeSubscription.planId, { session }) : null;
      const deliveryAddress = normalizeDeliveryAddress(
        payload.deliveryAddress,
        activeSubscription && activeSubscription.deliveryAddress
      );

      if (deliveryAddress !== undefined) {
        if (!activeSubscription || activeSubscription.deliveryMode !== "delivery") {
          throw customerManagementError(
            422,
            "ACTIVE_DELIVERY_SUBSCRIPTION_REQUIRED",
            "Address changes require an active delivery subscription"
          );
        }
      }

      const nextPhone = normalizedPhone === undefined
        ? (user.phoneE164 || user.phone)
        : normalizedPhone;
      const nextEmail = normalizedEmail === undefined
        ? (user.email || (appUser && appUser.email) || null)
        : normalizedEmail;

      await assertNoIdentityConflict({
        userId: user._id,
        appUserId: appUser && appUser._id,
        phone: nextPhone,
        email: nextEmail,
        session,
      });

      const before = {
        fullName: user.name || (appUser && appUser.fullName) || null,
        phone: user.phoneE164 || user.phone || null,
        email: user.email || (appUser && appUser.email) || null,
        isActive: user.isActive !== false,
        deliveryAddress: activeSubscription ? addressSnapshot(activeSubscription.deliveryAddress) : null,
      };

      if (normalizedFullName !== undefined) user.name = normalizedFullName || undefined;
      if (normalizedPhone !== undefined) {
        user.phone = normalizedPhone;
        user.phoneE164 = normalizedPhone;
        user.phoneVerified = true;
      }
      const emailChanged = normalizedEmail !== undefined && before.email !== normalizedEmail;
      if (normalizedEmail !== undefined) {
        user.email = normalizedEmail || undefined;
        if (emailChanged) {
          user.emailVerified = false;
          user.emailVerifiedAt = null;
          user.emailVerificationRequired = Boolean(normalizedEmail);
        }
      }
      if (payload.isActive !== undefined) user.isActive = payload.isActive;

      const identityChanged = before.phone !== nextPhone || before.email !== nextEmail;
      const deactivated = before.isActive === true && user.isActive === false;
      const sessionsRevoked = identityChanged || deactivated;
      if (sessionsRevoked) user.authVersion = Number(user.authVersion || 0) + 1;
      await user.save({ session });

      if (!appUser) {
        [appUser] = await AppUser.create([{
          coreUserId: user._id,
          fullName: user.name || undefined,
          phone: nextPhone,
          email: nextEmail || undefined,
        }], { session });
      } else {
        appUser.coreUserId = user._id;
        if (normalizedFullName !== undefined) appUser.fullName = normalizedFullName || undefined;
        if (normalizedPhone !== undefined) appUser.phone = normalizedPhone;
        if (normalizedEmail !== undefined) appUser.email = normalizedEmail || undefined;
        await appUser.save({ session });
      }

      if (deliveryAddress !== undefined) {
        activeSubscription.deliveryAddress = deliveryAddress;
        await activeSubscription.save({ session });
      }

      if (sessionsRevoked) {
        await RefreshSession.updateMany(
          { userId: user._id, revokedAt: null },
          { $set: { revokedAt: new Date(), revokedReason: "security" } },
          { session }
        );
      }
      if (normalizedPhone !== undefined && before.phone !== normalizedPhone) {
        await Otp.deleteMany({ phone: { $in: [before.phone, normalizedPhone].filter(Boolean) } }, { session });
      }
      if (emailChanged) {
        await EmailOtpChallenge.deleteMany({
          $or: [
            { userId: user._id },
            { email: { $in: [before.email, normalizedEmail].filter(Boolean) } },
          ],
        }, { session });
      }

      const after = {
        fullName: user.name || appUser.fullName || null,
        phone: user.phoneE164 || user.phone || appUser.phone || null,
        email: user.email || appUser.email || null,
        isActive: user.isActive !== false,
        deliveryAddress: activeSubscription ? addressSnapshot(activeSubscription.deliveryAddress) : null,
      };
      const fields = changedFields(before, after);
      if (!fields.length) {
        throw customerManagementError(400, "NO_CHANGES", "Submitted data matches the current customer data");
      }

      await ActivityLog.create([{
        entityType: "user",
        entityId: user._id,
        action: "customer_profile_updated_by_superadmin",
        byUserId: actorId,
        byRole: actorRole,
        meta: {
          reason,
          changedFields: fields,
          before,
          after,
          activeSubscriptionId: activeSubscription ? String(activeSubscription._id) : null,
          sessionsRevoked,
        },
      }], { session });

      result = {
        customer: serializeCustomer({ user, appUser, activeSubscription, plan }),
        changedFields: fields,
        sessionsRevoked,
      };
    });

    return result;
  } catch (error) {
    if (error && error.code === 11000) {
      throw customerManagementError(
        409,
        "CUSTOMER_IDENTITY_CONFLICT",
        "Another customer already uses this phone number or email address"
      );
    }
    throw error;
  } finally {
    session.endSession();
  }
}

module.exports = {
  grantCustomerMealCompensation,
  getCustomerManagementProfile,
  updateCustomerManagementProfile,
};
