const SharedMenuIdentity = require("../models/SharedMenuIdentity");
const MenuIdentityLink = require("../models/MenuIdentityLink");
const mongoose = require("mongoose");

/**
 * Normalizes a key for SharedMenuIdentity.
 * Lowercase, trimmed, and uses underscores for spaces.
 */
function normalizeIdentityKey(input) {
  if (!input || typeof input !== "string") return "";
  return input
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

/**
 * Normalizes an alias or name for comparison.
 * Standardizes Arabic characters to avoid common variations.
 */
function normalizeAlias(input) {
  if (!input || typeof input !== "string") return "";
  let val = input.toLowerCase().trim().replace(/\s+/g, " ");

  // Arabic normalization
  val = val.replace(/[أإآ]/g, "ا");
  val = val.replace(/ة/g, "ه");
  val = val.replace(/ى/g, "ي");

  return val;
}

async function createIdentity(payload, actor = null) {
  const data = { ...payload };
  if (data.key) data.key = normalizeIdentityKey(data.key);
  if (actor) {
    data.createdBy = actor._id || actor;
    data.updatedBy = actor._id || actor;
  }
  return await SharedMenuIdentity.create(data);
}

async function createLink(payload, actor = null) {
  const data = { ...payload };
  if (actor) {
    data.createdBy = actor._id || actor;
    data.updatedBy = actor._id || actor;
  }
  return await MenuIdentityLink.create(data);
}

async function findIdentityByKey(key) {
  return await SharedMenuIdentity.findOne({ key: normalizeIdentityKey(key) });
}

async function findLinksForIdentity(identityId) {
  return await MenuIdentityLink.find({ identityId }).lean();
}

/**
 * Read-only validation of identity links and their integrity.
 */
async function validateIdentityLinks({ failOnWarnings = false } = {}) {
  const errors = [];
  const warnings = [];

  const identities = await SharedMenuIdentity.find().lean();
  const links = await MenuIdentityLink.find().lean();

  const identityMap = new Map(identities.map((id) => [String(id._id), id]));
  const keyCounts = new Map();
  const aliasToIdentities = new Map();

  // 1. Check Identities
  for (const identity of identities) {
    // Duplicate keys
    const k = identity.key;
    keyCounts.set(k, (keyCounts.get(k) || 0) + 1);

    // Collect aliases for collision check
    const allAliases = [
      ...(identity.aliases?.ar || []),
      ...(identity.aliases?.en || []),
      identity.name?.ar,
      identity.name?.en,
    ]
      .filter(Boolean)
      .map(normalizeAlias);

    for (const alias of new Set(allAliases)) {
      if (!aliasToIdentities.has(alias)) aliasToIdentities.set(alias, []);
      aliasToIdentities.get(alias).push(identity.key);
    }
  }

  for (const [key, count] of keyCounts) {
    if (count > 1) {
      errors.push(`Duplicate identity key found: ${key} (${count} occurrences)`);
    }
  }

  for (const [alias, keys] of aliasToIdentities) {
    if (keys.length > 1) {
      warnings.push(`Alias collision: "${alias}" maps to multiple identities: ${keys.join(", ")}`);
    }
  }

  // 2. Check Links
  const activeSourceLinks = new Map(); // channel:model:id -> identityKey

  for (const link of links) {
    const identity = identityMap.get(String(link.identityId));

    // Link has existing identity
    if (!identity) {
      errors.push(`Link ${link._id} points to non-existent identityId ${link.identityId}`);
      continue;
    }

    // Inactive identity with active link
    if (!identity.isActive && link.isActive) {
      warnings.push(`Active link ${link._id} points to inactive identity "${identity.key}"`);
    }

    // Double mapping (one source -> multiple active identities)
    if (link.isActive) {
      const sourceKey = `${link.channel}:${link.sourceModel}:${link.sourceId}`;
      if (activeSourceLinks.has(sourceKey)) {
        errors.push(
          `Source record ${sourceKey} is linked to multiple active identities: ${activeSourceLinks.get(
            sourceKey
          )} and ${identity.key}`
        );
      } else {
        activeSourceLinks.set(sourceKey, identity.key);
      }
    }

    // Source existence check
    try {
      const SourceModel = mongoose.model(link.sourceModel);
      const sourceDoc = await SourceModel.findById(link.sourceId).lean();
      if (!sourceDoc) {
        errors.push(`Link ${link._id} sourceId ${link.sourceId} not found in model ${link.sourceModel}`);
      } else if (!sourceDoc.isActive && link.isActive) {
        warnings.push(`Active link ${link._id} points to inactive source record in ${link.sourceModel}`);
      }
    } catch (err) {
      errors.push(`Invalid sourceModel "${link.sourceModel}" in link ${link._id}: ${err.message}`);
    }
  }

  return {
    identitiesCount: identities.length,
    linksCount: links.length,
    errors,
    warnings,
    isValid: errors.length === 0 && (!failOnWarnings || warnings.length === 0),
  };
}

module.exports = {
  normalizeIdentityKey,
  normalizeAlias,
  createIdentity,
  createLink,
  findIdentityByKey,
  findLinksForIdentity,
  validateIdentityLinks,
};
