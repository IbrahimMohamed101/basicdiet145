#!/usr/bin/env node

require("dotenv").config();

const mongoose = require("mongoose");
const { connectDb } = require("../src/db");
const BuilderProtein = require("../src/models/BuilderProtein");
const MenuOption = require("../src/models/MenuOption");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const MenuProduct = require("../src/models/MenuProduct");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");
const SaladIngredient = require("../src/models/SaladIngredient");
const Subscription = require("../src/models/Subscription");
const CatalogService = require("../src/services/catalog/CatalogService");
const mealBuilderConfigService = require("../src/services/subscription/mealBuilderConfigService");
const {
  isSubscriptionPremiumLargeSaladProtein,
} = require("../src/services/subscription/premiumLargeSaladEligibilityService");

function argument(name) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((value) => value.startsWith(prefix));
  return raw ? raw.slice(prefix.length).trim() : "";
}

function requireObjectId(name) {
  const value = argument(name);
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw new Error(`--${name} must be a valid ObjectId`);
  }
  return value;
}

function catalogState(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id),
    key: doc.key || null,
    premiumKey: doc.premiumKey || null,
    groupId: doc.groupId ? String(doc.groupId) : null,
    isActive: doc.isActive !== false,
    isVisible: doc.isVisible !== false,
    isAvailable: doc.isAvailable !== false,
    isPublished: doc.publishedAt !== null && doc.publishedAt !== undefined,
    availableForSubscription: doc.availableForSubscription !== false,
    availableFor: Array.isArray(doc.availableFor) ? doc.availableFor : [],
  };
}

function relationState(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id),
    productId: String(doc.productId),
    groupId: String(doc.groupId),
    optionId: doc.optionId ? String(doc.optionId) : null,
    isActive: doc.isActive !== false,
    isVisible: doc.isVisible !== false,
    isAvailable: doc.isAvailable !== false,
  };
}

function findPlannerOption(plannerCatalog, optionId) {
  const matches = [];
  for (const section of plannerCatalog?.sections || []) {
    for (const product of section.products || []) {
      for (const group of product.optionGroups || []) {
        for (const option of group.options || []) {
          if (String(option.id || option.optionId || "") !== String(optionId)) continue;
          matches.push({
            sectionKey: section.key || null,
            productId: String(product.id || product.productId || ""),
            productKey: product.key || null,
            selectionType: product.selectionType || null,
            groupId: String(group.id || group.groupId || ""),
            groupKey: group.key || null,
            optionId: String(option.id || option.optionId),
            optionKey: option.key || null,
          });
        }
      }
    }
  }
  return matches;
}

async function inspectOption(optionId, saladProduct, membershipState) {
  const [menuOption, builderProtein, saladIngredient] = await Promise.all([
    MenuOption.findById(optionId)
      .select("key premiumKey groupId isActive isVisible isAvailable publishedAt availableFor availableForSubscription isPremium")
      .lean(),
    BuilderProtein.findById(optionId)
      .select("key premiumKey isActive isPremium availableForSubscription")
      .lean(),
    SaladIngredient.findById(optionId)
      .select("groupKey isActive")
      .lean(),
  ]);
  const group = menuOption?.groupId
    ? await MenuOptionGroup.findById(menuOption.groupId).select("key isActive isVisible isAvailable publishedAt").lean()
    : null;
  const [groupRelation, optionRelation] = saladProduct && group
    ? await Promise.all([
      ProductOptionGroup.findOne({ productId: saladProduct._id, groupId: group._id }).lean(),
      ProductGroupOption.findOne({ productId: saladProduct._id, groupId: group._id, optionId }).lean(),
    ])
    : [null, null];
  const publishedMembership = Boolean(
    membershipState.hasPublishedConfig
    && saladProduct
    && group
    && mealBuilderConfigService.isOptionIncluded(
      membershipState.membership,
      "premium_large_salad",
      saladProduct._id,
      group._id,
      optionId
    )
  );

  return {
    menuOption: catalogState(menuOption),
    builderProtein: builderProtein ? {
      id: String(builderProtein._id),
      key: builderProtein.key || null,
      premiumKey: builderProtein.premiumKey || null,
      isActive: builderProtein.isActive !== false,
      isPremium: builderProtein.isPremium === true,
      availableForSubscription: builderProtein.availableForSubscription !== false,
    } : null,
    saladIngredient: saladIngredient ? {
      id: String(saladIngredient._id),
      groupKey: saladIngredient.groupKey || null,
      isActive: saladIngredient.isActive !== false,
    } : null,
    resolvedGroup: catalogState(group),
    groupRelation: relationState(groupRelation),
    optionRelation: relationState(optionRelation),
    canonicalProteinAllowlist: menuOption ? isSubscriptionPremiumLargeSaladProtein(menuOption) : null,
    publishedBuilderMembership: membershipState.hasPublishedConfig ? publishedMembership : null,
  };
}

async function run() {
  const proteinId = requireObjectId("protein-id");
  const sauceId = requireObjectId("sauce-id");
  const subscriptionId = requireObjectId("subscription-id");
  await connectDb();

  const [saladProduct, subscription, membershipState] = await Promise.all([
    MenuProduct.findOne({ key: "premium_large_salad" })
      .select("key itemType isActive isVisible isAvailable publishedAt availableFor")
      .lean(),
    Subscription.findById(subscriptionId).select("status planId").lean(),
    mealBuilderConfigService.buildPublishedMembership(),
  ]);
  const [protein, sauce, catalogBundle] = await Promise.all([
    inspectOption(proteinId, saladProduct, membershipState),
    inspectOption(sauceId, saladProduct, membershipState),
    CatalogService.getSubscriptionBuilderCatalogWithV2({ lang: "en", includeV3: true, includeV2: false }),
  ]);

  const report = {
    mode: "read_only",
    runtimeCommit: process.env.RAILWAY_GIT_COMMIT_SHA
      || process.env.RENDER_GIT_COMMIT
      || process.env.SOURCE_VERSION
      || process.env.COMMIT_SHA
      || process.env.GIT_COMMIT
      || "unknown",
    subscription: {
      id: subscriptionId,
      exists: Boolean(subscription),
      status: subscription?.status || null,
      planId: subscription?.planId ? String(subscription.planId) : null,
      hasSaladEligibilitySnapshot: false,
    },
    premiumLargeSaladProduct: catalogState(saladProduct),
    publishedBuilder: {
      hasPublishedConfig: membershipState.hasPublishedConfig,
      revisionHash: membershipState.revisionHash || null,
    },
    protein: {
      requestedId: proteinId,
      ...protein,
      exposedByPlannerCatalog: findPlannerOption(catalogBundle.plannerCatalog, proteinId),
    },
    sauce: {
      requestedId: sauceId,
      ...sauce,
      exposedByPlannerCatalog: findPlannerOption(catalogBundle.plannerCatalog, sauceId),
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

run()
  .catch((error) => {
    console.error(JSON.stringify({ mode: "read_only", error: error.message }, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });
