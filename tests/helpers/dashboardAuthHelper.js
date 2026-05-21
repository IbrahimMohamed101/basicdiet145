const DashboardUser = require("../../src/models/DashboardUser");
const { issueDashboardAccessToken } = require("../../src/services/dashboardTokenService");

/**
 * Creates a dashboard user and returns the auth headers.
 * @param {string} role
 * @param {string} testTag - Optional tag to help with cleanup
 * @returns {Promise<{Authorization: string, 'Accept-Language': string, user: Object}>}
 */
async function dashboardAuth(role = "admin", testTag = "test") {
  const email = `test-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  const user = await DashboardUser.create({
    email,
    passwordHash: "not-needed-for-token-auth",
    role,
    isActive: true,
  });

  const token = issueDashboardAccessToken(user);

  return {
    headers: {
      Authorization: `Bearer ${token}`,
      "Accept-Language": "en",
    },
    user,
  };
}

async function cleanupDashboardUsers(testTag = "") {
  if (testTag) {
    await DashboardUser.deleteMany({ email: new RegExp(testTag) });
  } else {
    // Dangerous if not handled carefully, usually tests should use a regex tag
  }
}

module.exports = {
  dashboardAuth,
  cleanupDashboardUsers,
};
