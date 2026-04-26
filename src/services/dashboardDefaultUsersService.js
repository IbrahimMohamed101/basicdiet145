const DashboardUser = require("../models/DashboardUser");
const {
  normalizeDashboardEmail,
  buildDashboardEmailQuery,
  isValidEmailFormat,
  validateDashboardPassword,
  hashDashboardPassword,
} = require("./dashboardPasswordService");
const { logger } = require("../utils/logger");
const { WEAK_DEFAULT_PASSWORDS } = require("../utils/security");

function parseBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  return fallback;
}

function collectDefaultDashboardUsersFromEnv() {
  return [
    {
      role: "superadmin",
      email: process.env.DASHBOARD_DEFAULT_SUPERADMIN_EMAIL,
      password: process.env.DASHBOARD_DEFAULT_SUPERADMIN_PASSWORD,
      isActive: parseBoolean(process.env.DASHBOARD_DEFAULT_SUPERADMIN_ACTIVE, true),
    },
    {
      role: "admin",
      email: process.env.DASHBOARD_DEFAULT_ADMIN_EMAIL,
      password: process.env.DASHBOARD_DEFAULT_ADMIN_PASSWORD,
      isActive: parseBoolean(process.env.DASHBOARD_DEFAULT_ADMIN_ACTIVE, true),
    },
    {
      role: "kitchen",
      email: process.env.DASHBOARD_DEFAULT_KITCHEN_EMAIL,
      password: process.env.DASHBOARD_DEFAULT_KITCHEN_PASSWORD,
      isActive: parseBoolean(process.env.DASHBOARD_DEFAULT_KITCHEN_ACTIVE, true),
    },
    {
      role: "courier",
      email: process.env.DASHBOARD_DEFAULT_COURIER_EMAIL,
      password: process.env.DASHBOARD_DEFAULT_COURIER_PASSWORD,
      isActive: parseBoolean(process.env.DASHBOARD_DEFAULT_COURIER_ACTIVE, true),
    },
  ].filter((item) => item.email && item.password);
}

async function ensureDefaultDashboardUsers() {
  // SECURITY: Never auto-seed in production
  if (process.env.NODE_ENV === "production") {
    logger.warn("ensureDefaultDashboardUsers: skipped in production. Use 'npm run seed:dashboard-users' with strong, unique passwords.");
    return;
  }

  const seedUsers = collectDefaultDashboardUsersFromEnv();
  if (seedUsers.length === 0) {
    logger.info("No default dashboard users found in env. Skipping bootstrap seed.");
    return;
  }

  for (const user of seedUsers) {
    const normalizedEmail = normalizeDashboardEmail(user.email);
    if (!isValidEmailFormat(normalizedEmail)) {
      logger.warn("Skipping default dashboard user with invalid email", { role: user.role });
      continue;
    }

    // SECURITY: Reject well-known weak/default passwords
    if (WEAK_DEFAULT_PASSWORDS.has(user.password)) {
      logger.warn("Skipping default dashboard user with weak/default password", {
        role: user.role,
        email: normalizedEmail,
        reason: "Password matches a known weak default. Change it in .env.",
      });
      continue;
    }

    const passwordValidation = validateDashboardPassword(user.password);
    if (!passwordValidation.ok) {
      logger.warn("Skipping default dashboard user with weak password", {
        role: user.role,
        email: normalizedEmail,
        reason: passwordValidation.message,
      });
      continue;
    }

    const existing = await DashboardUser.findOne(buildDashboardEmailQuery(normalizedEmail)).lean();
    if (existing) {
      logger.info("Default dashboard user already exists. Skipping.", {
        email: normalizedEmail,
        role: existing.role,
      });
      continue;
    }

    const passwordHash = await hashDashboardPassword(user.password);
    const created = await DashboardUser.create({
      email: normalizedEmail,
      role: user.role,
      passwordHash,
      isActive: user.isActive,
      passwordChangedAt: new Date(),
    });

    logger.info("Created default dashboard user", {
      email: created.email,
      role: created.role,
      isActive: created.isActive,
    });
  }
}

module.exports = {
  ensureDefaultDashboardUsers,
  collectDefaultDashboardUsersFromEnv,
};
