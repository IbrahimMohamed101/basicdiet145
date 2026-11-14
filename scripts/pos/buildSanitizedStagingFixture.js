"use strict";
// Offline, read-only importer. Never connects to Production or Staging DB.
// Creates ONLY manager-reviewable drafts with all prices unset.
// Usage: node scripts/pos/buildSanitizedStagingFixture.js input.json output.json
const fs = require("node:fs");
const crypto = require("node:crypto");
const { normalizePosCatalog, DEFAULT_CHANNELS } = require("../../src/services/pos/catalogValidation");

const CATEGORY_MAP = {
  meals: "الوجبات",
  salads: "السلطات",
  breakfast: "الفطور",
  sandwiches: "الساندويتشات",
  desserts: "الحلويات",
  drinks: "المشروبات",
  addons: "الإضافات",
};
const PII_VALUE = /[^\s@]+@[^\s@]+\.[^\s@]+|(?:\+?\d[\s().-]*){10,}/;
const SAFE_TOP_LEVEL = new Set(["products", "source", "exportedAt"]);

function safeLabel(label) {
  if (typeof label !== "string" || !label.trim() || label.trim().length > 100
    || PII_VALUE.test(label)) {
    throw new Error("Unsafe or invalid product name in source export");
  }
  return label.trim();
}

function buildSanitizedStagingFixture(source) {
  if (!source || !Array.isArray(source.products) || source.products.length > 500
    || source.products.length < 1) {
    throw new Error("Expected a bounded non-personal product-only export");
  }
  for (const key of Object.keys(source)) {
    if (!SAFE_TOP_LEVEL.has(key)) {
      throw new Error("Raw database dumps, customer data and unknown collections are prohibited");
    }
  }
  const products = source.products.map((item) => {
    if (!item || typeof item !== "object") throw new Error("Invalid product export");
    const name = safeLabel(item.name);
    const category = String(item.category || "").toLowerCase();
    if (!Object.hasOwn(CATEGORY_MAP, category)) throw new Error("Unrecognized product category");
    const sourceKey = category + "|" + name;
    const id = "sample-" + crypto.createHash("sha256").update(sourceKey).digest("hex").slice(0, 16);
    const sizes = Array.isArray(item.sizes) && item.sizes.length
      ? item.sizes : ["حصة"];
    if (sizes.length > 10) throw new Error("Too many variants in source export");
    const variants = sizes.map((size, index) => {
      const label = safeLabel(String(size));
      return {
        id: "size-" + (index + 1),
        label,
        prices: Object.fromEntries(DEFAULT_CHANNELS.map(({ id: channel }) => [channel, null])),
      };
    });
    return {
      id, name, category, variants,
      hasAddons: false,
      active: false, // manager must explicitly approve availability/prices
    };
  });
  const categories = Object.entries(CATEGORY_MAP)
    .filter(([id]) => products.some((item) => item.category === id))
    .map(([id, label]) => ({ id, label }));
  return normalizePosCatalog({ channels: DEFAULT_CHANNELS, categories, products });
}

if (require.main === module) {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath || inputPath === outputPath) {
    throw new Error("Provide separate input and output JSON paths");
  }
  const raw = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const safe = buildSanitizedStagingFixture(raw);
  fs.writeFileSync(outputPath, JSON.stringify(safe, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log("Sanitized catalog draft created: " + safe.products.length + " inactive products; all POS prices unset.");
}

module.exports = { buildSanitizedStagingFixture };
