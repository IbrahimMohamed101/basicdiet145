"use strict";

const mongoose = require("mongoose");
const ActivityLog = require("../../models/ActivityLog");
const AppUser = require("../../models/AppUser");
const EmailOtpChallenge = require("../../models/EmailOtpChallenge");
const Otp = require("../../models/Otp");
const RefreshSession = require("../../models/RefreshSession");
const Subscription = require("../../models/Subscription");
const User = require("../../models/User");
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

function serializeActiveSubscription(subscription) {
  if (!subscription) return null;
  return {
    id: String(subscription._id),
    displayId: `SUB-${String(subscription._id).slice(-6).toUpperCase()}`,
    status: subscription.status,
    deliveryMode: subscription.deliveryMode,
    deliveryAddress: addressSnapshot(subscription.deliveryAddress),
  };
}

function serializeCustomer({ user, appUser, activeSubscription }) {
  return {
    id: String(user._id),
    coreUserId: String(user._id),
    appUserId: appUser ? String(appUser._id) : null,
    fullName: user.name || (appUser && appUser.fullName) || null,
    phone: user.phoneE164 || user.phone || (appUser && appUser.phone) || null,
    phoneE164: user.phoneE164 || user.phone || (appUser && appUser.phone) || null,
    email: user.email || (appUser && appUser.email) || null,
    isActive: user.isActive !== false,
    activeSubscription: serializeActiveSubscription(activeSubscription),
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

async function getCustomerManagementProfile(id) {
  const managed = await findManagedCustomer(id);
  if (!managed) {
    throw customerManagementError(404, "NOT_FOUND", "Customer account was not found");
  }
  const activeSubscription = await findActiveSubscription(managed.user._id);
  return serializeCustomer({ ...managed, activeSubscription });
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
        customer: serializeCustomer({ user, appUser, activeSubscription }),
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
  getCustomerManagementProfile,
  updateCustomerManagementProfile,
};
