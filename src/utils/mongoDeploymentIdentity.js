"use strict";

const crypto = require("node:crypto");
const { URL } = require("node:url");

function normalizeMongoDeploymentIdentity(uri) {
  const raw = String(uri || "").trim();
  if (!raw) return null;

  const protocol = raw.startsWith("mongodb+srv://")
    ? "mongodb+srv"
    : raw.startsWith("mongodb://")
      ? "mongodb"
      : null;
  if (!protocol) return null;

  try {
    const parseable = raw.replace(/^mongodb(?:\+srv)?:\/\//, "http://");
    const parsed = new URL(parseable);
    const hosts = String(parsed.host || "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean)
      .sort();
    const databaseName = decodeURIComponent(String(parsed.pathname || "").replace(/^\/+/, ""))
      .split("?")[0]
      .trim()
      .toLowerCase();
    if (!hosts.length || !databaseName) return null;
    return `${protocol}|${hosts.join(",")}|${databaseName}`;
  } catch (_err) {
    return null;
  }
}

function buildMongoDeploymentIdentityHash(uri) {
  const identity = normalizeMongoDeploymentIdentity(uri);
  if (!identity) return null;
  return `sha256:${crypto.createHash("sha256").update(identity).digest("hex")}`;
}

module.exports = {
  buildMongoDeploymentIdentityHash,
  normalizeMongoDeploymentIdentity,
};
