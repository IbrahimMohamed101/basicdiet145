const bcrypt = require("bcryptjs");
const { WEAK_DEFAULT_PASSWORDS } = require("../utils/security");

const DASHBOARD_MIN_PASSWORD_LENGTH = 12;

function normalizeDashboardEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildDashboardEmailQuery(email) {
  const normalized = normalizeDashboardEmail(email);
  return {
    email: { $regex: new RegExp(`^${escapeRegExp(normalized)}$`, "i") },
  };
}

function isValidEmailFormat(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));
}

function getBcryptRounds() {
  const rounds = Number(process.env.BCRYPT_ROUNDS || 10);
  if (!Number.isFinite(rounds) || rounds < 4 || rounds > 15) {
    return 10;
  }
  return Math.floor(rounds);
}

function validateDashboardPassword(password) {
  const raw = String(password || "");
  if (raw.length < DASHBOARD_MIN_PASSWORD_LENGTH) {
    return { ok: false, message: `password must be at least ${DASHBOARD_MIN_PASSWORD_LENGTH} characters` };
  }
  if (WEAK_DEFAULT_PASSWORDS && WEAK_DEFAULT_PASSWORDS.has(raw)) {
    return { ok: false, message: "password is too common or weak" };
  }
  if (!/[A-Z]/.test(raw)) {
    return { ok: false, message: "password must contain at least one uppercase letter" };
  }
  if (!/[a-z]/.test(raw)) {
    return { ok: false, message: "password must contain at least one lowercase letter" };
  }
  if (!/[0-9]/.test(raw)) {
    return { ok: false, message: "password must contain at least one number" };
  }
  if (!/[^A-Za-z0-9]/.test(raw)) {
    return { ok: false, message: "password must contain at least one symbol" };
  }
  return { ok: true };
}

async function hashDashboardPassword(password) {
  return bcrypt.hash(String(password), getBcryptRounds());
}

async function compareDashboardPassword(password, passwordHash) {
  if (!passwordHash) return false;
  return bcrypt.compare(String(password), String(passwordHash));
}

function sanitizeDashboardUser(userDoc) {
  if (!userDoc) return null;
  const user = typeof userDoc.toObject === "function" ? userDoc.toObject() : userDoc;
  return {
    id: String(user._id || user.id),
    email: user.email,
    role: user.role,
    isActive: Boolean(user.isActive),
    lastLoginAt: user.lastLoginAt || null,
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null,
  };
}

module.exports = {
  DASHBOARD_MIN_PASSWORD_LENGTH,
  normalizeDashboardEmail,
  buildDashboardEmailQuery,
  isValidEmailFormat,
  getBcryptRounds,
  validateDashboardPassword,
  hashDashboardPassword,
  compareDashboardPassword,
  sanitizeDashboardUser,
};
