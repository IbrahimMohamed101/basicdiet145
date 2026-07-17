"use strict";

const AppUser = require("../../models/AppUser");

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function enrichCustomerUsers(users = []) {
  const normalizedUsers = (Array.isArray(users) ? users : []).filter(Boolean);
  const ids = normalizedUsers.map((user) => user._id).filter(Boolean);
  const phones = normalizedUsers.map((user) => cleanText(user.phone)).filter(Boolean);

  if (!ids.length && !phones.length) return normalizedUsers;

  const clauses = [];
  if (ids.length) clauses.push({ coreUserId: { $in: ids } });
  if (phones.length) clauses.push({ phone: { $in: phones } });
  const appUsers = await AppUser.find({ $or: clauses })
    .select("coreUserId phone fullName")
    .lean();
  const byCoreUserId = new Map();
  const byPhone = new Map();

  for (const appUser of appUsers) {
    if (appUser.coreUserId) byCoreUserId.set(String(appUser.coreUserId), appUser);
    if (appUser.phone) byPhone.set(cleanText(appUser.phone), appUser);
  }

  return normalizedUsers.map((user) => {
    const appUser = byCoreUserId.get(String(user._id)) || byPhone.get(cleanText(user.phone));
    const displayName = cleanText(user.name) || cleanText(appUser && appUser.fullName);
    return displayName ? { ...user, name: displayName } : user;
  });
}

async function enrichCustomerUser(user) {
  if (!user) return null;
  const [enriched] = await enrichCustomerUsers([user]);
  return enriched || user;
}

module.exports = {
  enrichCustomerUser,
  enrichCustomerUsers,
};
