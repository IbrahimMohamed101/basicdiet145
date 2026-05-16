const bcrypt = require("bcryptjs");

function validateAppPassword(password) {
  const value = String(password || "");
  if (value.length < 8) {
    return { ok: false, message: "Password must be at least 8 characters" };
  }
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) {
    return { ok: false, message: "Password should include at least one letter and one number" };
  }
  return { ok: true };
}

async function hashAppPassword(password) {
  const rounds = Number(process.env.BCRYPT_ROUNDS || 10);
  return bcrypt.hash(String(password), rounds);
}

async function compareAppPassword(password, passwordHash) {
  if (!passwordHash) return false;
  return bcrypt.compare(String(password || ""), String(passwordHash));
}

module.exports = { validateAppPassword, hashAppPassword, compareAppPassword };
