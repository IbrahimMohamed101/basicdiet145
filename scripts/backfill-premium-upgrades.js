#!/usr/bin/env node

require("dotenv").config();
const mongoose = require("mongoose");

const BuilderProtein = require("../src/models/BuilderProtein");
const MenuOption = require("../src/models/MenuOption");
const MenuProduct = require("../src/models/MenuProduct");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const PremiumUpgradeConfig = require("../src/models/PremiumUpgradeConfig");
const Meal = require("../src/models/Meal");
const { resolvePremiumLargeSaladPricing } = require("../src/services/catalog/premiumLargeSaladPricingService");
const {
  PREMIUM_LARGE_SALAD_KEY,
  resolvePremiumKeyFromName,
} = require("../src/utils/subscription/premiumIdentity");
const { resolveMongoUri } = require("../src/utils/mongoUriResolver");

function isTruthy(value) {
  return ["1", "true", "yes", "y"].includes(String(value || "").trim().toLowerCase());
}

function normalizeKey(value) {
  return String(value || "").trim();
}

function buildSourceSnapshot(source, context = {}) {
  return {
    key: normalizeKey(source && source.key),
    name: source && source.name ? source.name : { ar: "", en: "" },
    context,
  };
}

async function discoverPremiumProteinSources() {
  const proteins = await BuilderProtein.find({
    isPremium: true,
    isActive: true,
    isArchived: { $ne: true },
  }).sort({ sortOrder: 1, createdAt: 1 }).lean();

  const discovered = [];
  const unresolved = [];

  for (const protein of proteins) {
    const premiumKey = normalizeKey(protein.premiumKey || protein.key);
    const optionKey = normalizeKey(protein.key || protein.premiumKey);
    if (!premiumKey || !optionKey) {
      unresolved.push({ premiumKey: premiumKey || null, reason: "Premium BuilderProtein is missing key/premiumKey" });
      continue;
    }

    const option = await MenuOption.findOne({ key: optionKey, isActive: true }).lean();
    if (!option) {
      unresolved.push({ premiumKey, reason: `No active MenuOption found for key ${optionKey}` });
      continue;
    }

    const relations = await ProductGroupOption.find({
      optionId: option._id,
      isActive: true,
      isVisible: { $ne: false },
      isAvailable: { $ne: false },
    }).sort({ sortOrder: 1, createdAt: 1 }).lean();

    if (relations.length === 0) {
      unresolved.push({ premiumKey, reason: "No active product/group relation found" });
      continue;
    }
    if (relations.length > 1) {
      unresolved.push({
        premiumKey,
        reason: "Multiple active relations found; exact relation must be selected from the dashboard",
        relationIds: relations.map((row) => String(row._id)),
      });
      continue;
    }

    const relation = relations[0];
    const upgradeDeltaHalala = Number(
      relation.extraPriceHalala
      ?? protein.extraFeeHalala
      ?? option.extraPriceHalala
      ?? option.extraFeeHalala
      ?? 0
    );

    if (!Number.isInteger(upgradeDeltaHalala) || upgradeDeltaHalala < 0) {
      unresolved.push({ premiumKey, reason: "Invalid premium upgrade price" });
      continue;
    }

    discovered.push({
      sourceType: "menu_option",
      sourceId: option._id,
      sourceProductId: relation.productId,
      sourceGroupId: relation.groupId,
      selectionType: "premium_meal",
      premiumKey,
      displayGroupKey: "premium",
      upgradeDeltaHalala,
      currency: protein.currency || "SAR",
      isEnabled: true,
      isVisible: true,
      status: "active",
      sortOrder: Number(protein.sortOrder || 0),
      metadata: { bootstrapSeed: true, discoveredFrom: "BuilderProtein.isPremium" },
      sourceSnapshot: buildSourceSnapshot(option, {
        relationId: String(relation._id),
        sourceProductId: String(relation.productId),
        sourceGroupId: String(relation.groupId),
      }),
    });
  }

  return { discovered, unresolved };
}

async function discoverPremiumLargeSaladSource() {
  const product = await MenuProduct.findOne({ key: PREMIUM_LARGE_SALAD_KEY, isActive: true }).lean();
  if (!product) return { discovered: null, unresolved: null };

  const saladPricing = await resolvePremiumLargeSaladPricing();
  if (!saladPricing || !saladPricing.productId) {
    return {
      discovered: null,
      unresolved: { premiumKey: PREMIUM_LARGE_SALAD_KEY, reason: "Premium large salad exists but pricing could not be resolved" },
    };
  }

  const upgradeDeltaHalala = Number(saladPricing.extraFeeHalala ?? product.priceHalala ?? 0);
  if (!Number.isInteger(upgradeDeltaHalala) || upgradeDeltaHalala < 0) {
    return {
      discovered: null,
      unresolved: { premiumKey: PREMIUM_LARGE_SALAD_KEY, reason: "Premium large salad has an invalid upgrade price" },
    };
  }

  return {
    discovered: {
      sourceType: "menu_product",
      sourceId: product._id,
      sourceProductId: null,
      sourceGroupId: null,
      selectionType: "premium_large_salad",
      premiumKey: PREMIUM_LARGE_SALAD_KEY,
      displayGroupKey: "premium",
      upgradeDeltaHalala,
      currency: product.currency || "SAR",
      isEnabled: true,
      isVisible: true,
      status: "active",
      sortOrder: Number(product.sortOrder || 0),
      metadata: { bootstrapSeed: true, discoveredFrom: "MenuProduct" },
      sourceSnapshot: buildSourceSnapshot(product),
    },
    unresolved: null,
  };
}

function configNeedsSync(existing, payload) {
  const fields = [
    "sourceType",
    "sourceId",
    "sourceProductId",
    "sourceGroupId",
    "selectionType",
    "premiumKey",
    "displayGroupKey",
    "upgradeDeltaHalala",
    "currency",
    "isEnabled",
    "isVisible",
    "status",
    "sortOrder",
  ];

  return fields.some((field) => {
    const left = existing[field] == null ? null : String(existing[field]);
    const right = payload[field] == null ? null : String(payload[field]);
    return left !== right;
  });
}

async function upsertDiscoveredConfig(payload, { sync = false } = {}) {
  const existing = await PremiumUpgradeConfig.findOne({ premiumKey: payload.premiumKey });
  if (!existing) {
    await PremiumUpgradeConfig.create(payload);
    return "created";
  }
  if (!sync || !configNeedsSync(existing, payload)) return "skipped";

  await PremiumUpgradeConfig.updateOne(
    { _id: existing._id },
    { $set: payload, $inc: { revision: 1 }, $unset: { archiveReason: "" } },
    { runValidators: true }
  );
  return "updated";
}

async function backfillLegacyMealIdentities() {
  let count = 0;
  const legacyPremiumMeals = await Meal.find({
    type: "premium",
    $or: [{ premiumKey: null }, { premiumKey: "" }, { premiumKey: { $exists: false } }],
  });

  for (const meal of legacyPremiumMeals) {
    const premiumKey = resolvePremiumKeyFromName(meal.name?.en || meal.name?.ar || "");
    if (!premiumKey) continue;
    meal.premiumKey = premiumKey;
    await meal.save();
    count += 1;
  }
  return count;
}

async function backfillPremiumUpgrades({ sync = false, failOnUnresolved = false, log = console } = {}) {
  log.log(`Starting dynamic Premium Upgrade Config reconciliation (mode=${sync ? "sync-initial-rows" : "create-missing-only"})...`);

  const proteinSources = await discoverPremiumProteinSources();
  const saladSource = await discoverPremiumLargeSaladSource();
  const discovered = [...proteinSources.discovered];
  const unresolved = [...proteinSources.unresolved];

  if (saladSource.discovered) discovered.push(saladSource.discovered);
  if (saladSource.unresolved) unresolved.push(saladSource.unresolved);

  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  for (const payload of discovered) {
    const result = await upsertDiscoveredConfig(payload, { sync });
    if (result === "created") createdCount += 1;
    else if (result === "updated") updatedCount += 1;
    else skippedCount += 1;
  }

  const mealIdentityBackfilledCount = await backfillLegacyMealIdentities();
  log.log(`Premium reconciliation complete. Discovered=${discovered.length} Created=${createdCount} Updated=${updatedCount} Skipped=${skippedCount} Unresolved=${unresolved.length} Meal identities=${mealIdentityBackfilledCount}`);

  if (unresolved.length > 0) {
    (log.warn || log.log).call(
      log,
      "Unresolved premium sources were left untouched because bootstrap data is non-authoritative:",
      JSON.stringify(unresolved, null, 2)
    );
  }

  if (failOnUnresolved && unresolved.length > 0) {
    const err = new Error("Some discovered premium sources require manual relation/configuration review");
    err.code = "PREMIUM_BOOTSTRAP_UNRESOLVED";
    err.details = unresolved;
    throw err;
  }

  return {
    discoveredCount: discovered.length,
    createdCount,
    updatedCount,
    repairedCount: updatedCount,
    skippedCount,
    mealIdentityBackfilledCount,
    unresolvedSources: unresolved,
  };
}

async function run(argv = process.argv.slice(2)) {
  const sync = argv.includes("--sync") || isTruthy(process.env.BOOTSTRAP_SYNC);
  const failOnUnresolved = argv.includes("--strict") || isTruthy(process.env.PREMIUM_BOOTSTRAP_STRICT);
  try {
    await mongoose.connect(resolveMongoUri(), { serverSelectionTimeoutMS: 10000 });
    await backfillPremiumUpgrades({ sync, failOnUnresolved });
  } finally {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error("Premium reconciliation failed:", error);
    process.exit(1);
  });
}

module.exports = {
  backfillPremiumUpgrades,
  discoverPremiumLargeSaladSource,
  discoverPremiumProteinSources,
  upsertDiscoveredConfig,
};
