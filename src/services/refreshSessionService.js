const crypto = require("crypto");
const RefreshSession = require("../models/RefreshSession");

const DEFAULT_ROTATION_GRACE_MS = 5000;
const MAX_ROTATION_GRACE_MS = 10000;

function getRefreshExpiresDays() {
  const days = Number(process.env.REFRESH_TOKEN_EXPIRES_DAYS || 30);
  return Number.isFinite(days) && days > 0 ? days : 30;
}

function getRefreshExpiresInSeconds() {
  return getRefreshExpiresDays() * 24 * 60 * 60;
}

function getRefreshRotationGraceMs() {
  const value = Number(process.env.REFRESH_ROTATION_GRACE_MS);
  if (!Number.isFinite(value)) return DEFAULT_ROTATION_GRACE_MS;
  return Math.min(MAX_ROTATION_GRACE_MS, Math.max(0, Math.floor(value)));
}

function generateRefreshToken() {
  return crypto.randomBytes(48).toString("base64url");
}

function hashRefreshToken(refreshToken) {
  const secret = process.env.REFRESH_TOKEN_HASH_SECRET
    || process.env.JWT_ACCESS_SECRET
    || process.env.JWT_SECRET
    || "refresh-token-secret";
  return crypto.createHmac("sha256", secret).update(String(refreshToken || "")).digest("hex");
}

function resolveClientIp(req) {
  return req.ip || (req.connection && req.connection.remoteAddress) || null;
}

function isWithinRotationGrace(session, now = Date.now()) {
  if (!session || session.revokedReason !== "rotation" || !session.revokedAt) {
    return false;
  }
  const graceMs = getRefreshRotationGraceMs();
  if (graceMs <= 0) return false;
  const revokedAtMs = new Date(session.revokedAt).getTime();
  return Number.isFinite(revokedAtMs)
    && revokedAtMs <= now
    && now - revokedAtMs <= graceMs;
}

async function createRefreshSession({ userId, req, deviceId, deviceName, session = null }) {
  const refreshToken = generateRefreshToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + getRefreshExpiresInSeconds() * 1000);

  const payload = {
    userId,
    refreshTokenHash: hashRefreshToken(refreshToken),
    deviceId: deviceId ? String(deviceId).trim() : null,
    deviceName: deviceName ? String(deviceName).trim() : null,
    userAgent: req && req.get ? req.get("user-agent") || null : null,
    ipAddress: req ? resolveClientIp(req) : null,
    expiresAt,
    lastUsedAt: now,
  };
  if (session) {
    await RefreshSession.create([payload], { session });
  } else {
    await RefreshSession.create(payload);
  }

  return { refreshToken, expiresAt, refreshExpiresIn: getRefreshExpiresInSeconds() };
}

async function findRefreshSession(refreshToken) {
  const tokenHash = hashRefreshToken(refreshToken);
  return RefreshSession.findOne({ refreshTokenHash: tokenHash });
}

async function findUsableRefreshSession(refreshToken) {
  if (!refreshToken) return { session: null, reason: "invalid" };
  const session = await findRefreshSession(refreshToken);
  if (!session) return { session: null, reason: "invalid" };
  if (session.expiresAt.getTime() <= Date.now()) return { session: null, reason: "expired" };

  if (session.revokedAt) {
    if (!isWithinRotationGrace(session)) {
      return { session: null, reason: "revoked" };
    }

    // Flutter can issue multiple requests together when a 15-minute access token
    // expires. Each request may attempt refresh with the same token. Mark this
    // short, rotation-only replay so rotateRefreshSession can issue another valid
    // replacement without treating a real logout/password reset as reusable.
    session.__rotationGrace = true;
  }

  session.lastUsedAt = new Date();
  await session.save();
  return { session, reason: null };
}

async function revokeRefreshToken(refreshToken, reason = "logout") {
  if (!refreshToken) return { revoked: false, reason: "missing" };
  const session = await findRefreshSession(refreshToken);
  if (!session) return { revoked: false, reason: "invalid" };
  if (session.revokedAt) return { revoked: false, reason: "revoked" };
  session.revokedAt = new Date();
  session.revokedReason = reason;
  await session.save();
  return { revoked: true, reason: null };
}

async function rotateRefreshSession({ session, req, deviceId, deviceName }) {
  if (!session.__rotationGrace) {
    session.revokedAt = new Date();
    session.revokedReason = "rotation";
    await session.save();
  }

  return createRefreshSession({
    userId: session.userId,
    req,
    deviceId: deviceId !== undefined ? deviceId : session.deviceId,
    deviceName: deviceName !== undefined ? deviceName : session.deviceName,
  });
}

async function revokeAllUserSessions(userId, reason = "logout_all", session = null) {
  await RefreshSession.updateMany(
    { userId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason } },
    session ? { session } : undefined
  );
}

module.exports = {
  createRefreshSession,
  findUsableRefreshSession,
  revokeRefreshToken,
  rotateRefreshSession,
  revokeAllUserSessions,
  getRefreshExpiresInSeconds,
  getRefreshRotationGraceMs,
  hashRefreshToken,
  isWithinRotationGrace,
};
