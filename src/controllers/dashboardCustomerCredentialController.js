"use strict";

const AppUser = require("../models/AppUser");
const User = require("../models/User");
const errorResponse = require("../utils/errorResponse");
const validateObjectId = require("../utils/validateObjectId");
const {
  issueCustomerTemporaryPassword,
} = require("../services/customerTemporaryPasswordService");

async function findCustomerByAnyId(id) {
  let user = await User.findOne({ _id: id, role: "client" });
  if (user) return user;

  const appUser = await AppUser.findById(id).lean();
  if (!appUser) return null;

  if (appUser.coreUserId) {
    user = await User.findOne({ _id: appUser.coreUserId, role: "client" });
    if (user) return user;
  }

  if (appUser.phone) {
    user = await User.findOne({
      role: "client",
      $or: [{ phone: appUser.phone }, { phoneE164: appUser.phone }],
    });
  }

  return user || null;
}

async function issueTemporaryCustomerCredential(req, res) {
  try {
    validateObjectId(req.params.id, "id");

    const user = await findCustomerByAnyId(req.params.id);
    if (!user) {
      return errorResponse(res, 404, "NOT_FOUND", "Customer account was not found");
    }
    if (user.isActive === false) {
      return errorResponse(
        res,
        403,
        "FORBIDDEN",
        "Inactive customers must be reactivated before credential reset"
      );
    }

    const body = req.body || {};
    const issued = await issueCustomerTemporaryPassword({
      user,
      temporaryPassword: body.password || body.temporaryPassword,
      reason: "admin_reset",
      actorId: req.dashboardUserId,
      actorRole: req.dashboardUserRole,
      resetReason: body.reason,
      revokeSessions: true,
      invalidateAccessTokens: true,
    });

    return res.status(200).json({
      status: true,
      message: "Customer credentials reset successfully.",
      messageAr: "تمت إعادة تعيين بيانات دخول العميل بنجاح.",
      data: {
        userId: String(user._id),
        phoneE164: user.phoneE164 || user.phone,
        accountStatus: user.accountStatus,
        forcePasswordChange: true,
        temporaryPassword: issued.temporaryPassword,
        temporaryPasswordExpiresAt: issued.expiresAt,
        sessionsRevoked: true,
      },
    });
  } catch (err) {
    if (err && Number.isInteger(err.status)) {
      return errorResponse(res, err.status, err.code || "INVALID", err.message);
    }
    throw err;
  }
}

module.exports = {
  findCustomerByAnyId,
  issueTemporaryCustomerCredential,
};
