const crypto = require("crypto");
const RefreshSession = require("../models/RefreshSession");

function getRefreshExpiresDays() {
  const days = Number(process.env.REFRESH_TOKEN_EXPIRES_DAYS || 30);
  return Number.isFinite(days) && days > 0 ? days : 30;
}

function getRefreshExpiresInSeconds() {
  return getRefreshExpiresDays() * 24 * 60 * 60;
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

async function createRefreshSession({ userId, req, deviceId, deviceName }) {
  const refreshToken = generateRefreshToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + getRefreshExpiresInSeconds() * 1000);

  await RefreshSession.create({
    userId,
    refreshTokenHash: hashRefreshToken(refreshToken),
    deviceId: deviceId ? String(deviceId).trim() : null,
    deviceName: deviceName ? String(deviceName).trim() : null,
    userAgent: req && req.get ? req.get("user-agent") || null : null,
    ipAddress: req ? resolveClientIp(req) : null,
    expiresAt,
    lastUsedAt: now,
  });

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
  if (session.revokedAt) return { session: null, reason: "revoked" };
  if (session.expiresAt.getTime() <= Date.now()) return { session: null, reason: "expired" };
  session.lastUsedAt = new Date();
  await session.save();
  return { session, reason: null };
}

async function revokeRefreshToken(refreshToken) {
  if (!refreshToken) return { revoked: false, reason: "missing" };
  const session = await findRefreshSession(refreshToken);
  if (!session) return { revoked: false, reason: "invalid" };
  if (session.revokedAt) return { revoked: false, reason: "revoked" };
  session.revokedAt = new Date();
  await session.save();
  return { revoked: true, reason: null };
}

async function rotateRefreshSession({ session, req, deviceId, deviceName }) {
  session.revokedAt = new Date();
  await session.save();
  return createRefreshSession({
    userId: session.userId,
    req,
    deviceId: deviceId !== undefined ? deviceId : session.deviceId,
    deviceName: deviceName !== undefined ? deviceName : session.deviceName,
  });
}

async function revokeAllUserSessions(userId) {
  await RefreshSession.updateMany(
    { userId, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
}

module.exports = {
  createRefreshSession,
  findUsableRefreshSession,
  revokeRefreshToken,
  rotateRefreshSession,
  revokeAllUserSessions,
  getRefreshExpiresInSeconds,
  hashRefreshToken,
};
