"use strict";

process.env.NODE_ENV = "test";
process.env.REFRESH_ROTATION_GRACE_MS = "5000";
process.env.REFRESH_TOKEN_EXPIRES_DAYS = "30";
process.env.JWT_SECRET = process.env.JWT_SECRET || "refresh-grace-test-secret";

const assert = require("assert");
const RefreshSession = require("../src/models/RefreshSession");
const {
  findUsableRefreshSession,
  getRefreshExpiresDays,
  getRefreshExpiresInSeconds,
  getRefreshRotationGraceMs,
  isWithinRotationGrace,
  revokeRefreshToken,
  rotateRefreshSession,
} = require("../src/services/refreshSessionService");

const originalFindOne = RefreshSession.findOne;
const originalCreate = RefreshSession.create;

function makeSession(overrides = {}) {
  return {
    userId: "507f1f77bcf86cd799439011",
    deviceId: "device-1",
    deviceName: "iPhone",
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    revokedReason: null,
    lastUsedAt: null,
    saveCount: 0,
    async save() {
      this.saveCount += 1;
      return this;
    },
    ...overrides,
  };
}

async function run() {
  try {
    assert.strictEqual(getRefreshRotationGraceMs(), 5000);
    assert.strictEqual(getRefreshExpiresDays(), 30);

    process.env.REFRESH_TOKEN_EXPIRES_DAYS = "60";
    assert.strictEqual(getRefreshExpiresDays(), 60);
    assert.strictEqual(getRefreshExpiresInSeconds(), 60 * 24 * 60 * 60);

    process.env.REFRESH_TOKEN_EXPIRES_DAYS = "365";
    assert.strictEqual(getRefreshExpiresDays(), 90, "configured session TTL must be capped at 90 days");

    process.env.REFRESH_TOKEN_EXPIRES_DAYS = "invalid";
    assert.strictEqual(getRefreshExpiresDays(), 60, "invalid session TTL must use the safe 60-day default");
    process.env.REFRESH_TOKEN_EXPIRES_DAYS = "30";

    const recentRotation = makeSession({
      revokedAt: new Date(Date.now() - 1000),
      revokedReason: "rotation",
    });
    assert.strictEqual(isWithinRotationGrace(recentRotation), true);

    RefreshSession.findOne = async () => recentRotation;
    let result = await findUsableRefreshSession("rotated-token");
    assert.strictEqual(result.reason, null);
    assert.strictEqual(result.session, recentRotation);
    assert.strictEqual(result.session.__rotationGrace, true);
    assert.strictEqual(recentRotation.saveCount, 1);

    const loggedOut = makeSession({
      revokedAt: new Date(Date.now() - 1000),
      revokedReason: "logout",
    });
    RefreshSession.findOne = async () => loggedOut;
    result = await findUsableRefreshSession("logged-out-token");
    assert.strictEqual(result.session, null);
    assert.strictEqual(result.reason, "revoked");

    const staleRotation = makeSession({
      revokedAt: new Date(Date.now() - 6000),
      revokedReason: "rotation",
    });
    RefreshSession.findOne = async () => staleRotation;
    result = await findUsableRefreshSession("stale-rotation-token");
    assert.strictEqual(result.session, null);
    assert.strictEqual(result.reason, "revoked");

    let createdDocument = null;
    RefreshSession.create = async (document) => {
      createdDocument = document;
      return document;
    };

    const graceSession = makeSession({ __rotationGrace: true });
    const rotatedFromGrace = await rotateRefreshSession({
      session: graceSession,
      req: null,
    });
    assert(rotatedFromGrace.refreshToken);
    assert.strictEqual(graceSession.saveCount, 0);
    assert(createdDocument && createdDocument.refreshTokenHash);

    const normalSession = makeSession();
    await rotateRefreshSession({ session: normalSession, req: null });
    assert.strictEqual(normalSession.revokedReason, "rotation");
    assert(normalSession.revokedAt instanceof Date);
    assert.strictEqual(normalSession.saveCount, 1);

    const logoutSession = makeSession();
    RefreshSession.findOne = async () => logoutSession;
    const revoked = await revokeRefreshToken("logout-token");
    assert.strictEqual(revoked.revoked, true);
    assert.strictEqual(logoutSession.revokedReason, "logout");
    assert(logoutSession.revokedAt instanceof Date);

    console.log("refresh session rotation grace checks passed");
  } finally {
    RefreshSession.findOne = originalFindOne;
    RefreshSession.create = originalCreate;
  }
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
