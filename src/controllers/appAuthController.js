const AppUser = require("../models/AppUser");
const User = require("../models/User");
const Subscription = require("../models/Subscription");
const SubscriptionDay = require("../models/SubscriptionDay");
const { isApiError, ApiError } = require("../utils/apiError");
const { assertValidPhoneE164, requestOtpForPhone } = require("../services/otpService");
const errorResponse = require("../utils/errorResponse");
const { getTodayKSADate } = require("../utils/date");

function serializeCoreUser(user) {
  return {
    id: String(user._id),
    fullName: user.name || null,
    phone: user.phone,
    email: user.email || null,
    role: "client",
    createdAt: user.createdAt,
  };
}

function handleError(res, err) {
  if (err && err.code === 11000) {
    const key = Object.keys(err.keyValue || err.keyPattern || {})[0] || "field";
    return errorResponse(res, 409, "CONFLICT", `${key} already in use`);
  }
  if (isApiError(err)) {
    return errorResponse(res, err.status, err.code, err.message, err.details);
  }
  return errorResponse(res, 500, "INTERNAL", "Unexpected error");
}

function normalizeRequiredFullName(fullName) {
  const normalized = String(fullName || "").trim();
  if (!normalized) {
    throw new ApiError({
      status: 400,
      code: "INVALID_FULL_NAME",
      message: "fullName is required",
    });
  }
  return normalized;
}

function normalizeOptionalEmail(email) {
  if (email === undefined) {
    return undefined;
  }
  if (email === null || email === "") {
    return null;
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new ApiError({
      status: 400,
      code: "INVALID_EMAIL",
      message: "email must be a valid email address",
    });
  }
  return normalizedEmail;
}

async function getAuthenticatedCoreUserOrThrow(userId) {
  const coreUser = await User.findById(userId);
  if (!coreUser) {
    throw new ApiError({
      status: 401,
      code: "UNAUTHORIZED",
      message: "Invalid app access token",
    });
  }
  return coreUser;
}

async function ensureRegistrationEmailAvailable(email, phone) {
  if (!email) {
    return;
  }

  const existingAppUser = await AppUser.findOne({ email }).lean();
  if (existingAppUser && existingAppUser.phone !== phone) {
    throw new ApiError({
      status: 409,
      code: "EMAIL_IN_USE",
      message: "email is already in use",
    });
  }
}

async function ensureLinkedAppUser(coreUser) {
  let appUser = await AppUser.findOne({ phone: coreUser.phone });
  if (!appUser) {
    appUser = new AppUser({ phone: coreUser.phone, coreUserId: coreUser._id });
  } else if (!appUser.coreUserId || String(appUser.coreUserId) !== String(coreUser._id)) {
    appUser.coreUserId = coreUser._id;
  }

  appUser.fullName = coreUser.name ? String(coreUser.name).trim() : undefined;
  appUser.email = coreUser.email ? String(coreUser.email).trim().toLowerCase() : undefined;
  await appUser.save();
  return appUser;
}

async function login(req, res) {
  try {
    const { phoneE164 } = req.body || {};
    const phone = assertValidPhoneE164(phoneE164);
    await requestOtpForPhone(phone, { context: "app_login" });

    return res.status(200).json({
      ok: true,
      message: "OTP sent successfully",
      data: {
        phoneE164: phone,
        nextStep: "verify",
      },
    });
  } catch (err) {
    return handleError(res, err);
  }
}

async function register(req, res) {
  try {
    const { fullName, phoneE164, email } = req.body || {};
    const normalizedFullName = normalizeRequiredFullName(fullName);
    const phone = assertValidPhoneE164(phoneE164);
    const normalizedEmail = normalizeOptionalEmail(email);

    await ensureRegistrationEmailAvailable(normalizedEmail, phone);
    await requestOtpForPhone(phone, {
      context: "app_register",
      pendingProfile: {
        fullName: normalizedFullName,
        email: normalizedEmail,
      },
    });

    return res.status(200).json({
      ok: true,
      message: "OTP sent successfully",
      data: {
        phoneE164: phone,
        nextStep: "verify",
      },
    });
  } catch (err) {
    return handleError(res, err);
  }
}

async function getProfile(req, res) {
  try {
    const coreUser = await getAuthenticatedCoreUserOrThrow(req.userId);
    return res.status(200).json({
      ok: true,
      user: serializeCoreUser(coreUser),
    });
  } catch (err) {
    return handleError(res, err);
  }
}

async function updateProfile(req, res) {
  try {
    const { fullName, email } = req.body || {};
    const hasFullName = Object.prototype.hasOwnProperty.call(req.body || {}, "fullName");
    const hasEmail = Object.prototype.hasOwnProperty.call(req.body || {}, "email");

    if (!hasFullName && !hasEmail) {
      throw new ApiError({
        status: 400,
        code: "INVALID",
        message: "At least one of fullName or email is required",
      });
    }

    const coreUser = await getAuthenticatedCoreUserOrThrow(req.userId);

    if (hasFullName) {
      coreUser.name = normalizeRequiredFullName(fullName);
    }

    if (hasEmail) {
      const normalizedEmail = normalizeOptionalEmail(email);
      if (normalizedEmail === null) {
        coreUser.email = undefined;
      } else {
        await ensureRegistrationEmailAvailable(normalizedEmail, coreUser.phone);
        coreUser.email = normalizedEmail;
      }
    }

    await coreUser.save();
    await ensureLinkedAppUser(coreUser);

    return res.status(200).json({
      ok: true,
      user: serializeCoreUser(coreUser),
    });
  } catch (err) {
    return handleError(res, err);
  }
}

function resolveTodayPickupStatusOrder(status) {
  switch (String(status || "")) {
    case "ready_for_pickup":
      return 0;
    case "in_preparation":
      return 1;
    case "locked":
      return 2;
    case "open":
      return 3;
    case "fulfilled":
      return 4;
    case "no_show":
      return 5;
    case "canceled_at_branch":
      return 6;
    default:
      return 99;
  }
}

async function getTodayPickup(req, res) {
  try {
    const today = getTodayKSADate();
    const pickupSubscriptions = await Subscription.find({
      userId: req.userId,
      deliveryMode: "pickup",
      status: "active",
    })
      .select("_id")
      .lean();
    const subscriptionIds = pickupSubscriptions.map((sub) => sub._id);
    if (!subscriptionIds.length) {
      return errorResponse(res, 404, "NOT_FOUND", "No active pickup subscription found");
    }

    const days = await SubscriptionDay.find({
      subscriptionId: { $in: subscriptionIds },
      date: today,
      status: { $in: ["open", "locked", "in_preparation", "ready_for_pickup", "fulfilled", "no_show", "canceled_at_branch"] },
    })
      .select("status pickupCode lockedSnapshot fulfilledSnapshot")
      .lean();
    if (!days.length) {
      return errorResponse(res, 404, "NOT_FOUND", "No pickup day found for today");
    }

    const selectedDay = days.sort(
      (left, right) => resolveTodayPickupStatusOrder(left.status) - resolveTodayPickupStatusOrder(right.status)
    )[0];
    const snapshot = selectedDay.lockedSnapshot || selectedDay.fulfilledSnapshot || {};

    return res.status(200).json({
      ok: true,
      data: {
        status: selectedDay.status || "open",
        branchName: snapshot.pickupLocationName || "",
        pickupWindow: snapshot.deliveryWindow || null,
        code: selectedDay.status === "ready_for_pickup" ? String(selectedDay.pickupCode || "") : "",
      },
    });
  } catch (err) {
    return handleError(res, err);
  }
}

module.exports = { login, register, getProfile, updateProfile, getTodayPickup };
