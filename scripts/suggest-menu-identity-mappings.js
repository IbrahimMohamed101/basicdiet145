/**
 * scripts/suggest-menu-identity-mappings.js
 * 
 * Scans one-time and subscription menu sources to suggest SharedMenuIdentity/MenuIdentityLink mappings.
 * 
 * Safety:
 * - Dry-run by default.
 * - Requires MENU_IDENTITY_SUGGESTIONS_WRITE=true to write to staging (MenuIdentitySuggestion).
 * - Production write restricted.
 */
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const { normalizeAlias, normalizeIdentityKey } = require("../src/services/menuIdentityMappingService");
const SharedMenuIdentity = require("../src/models/SharedMenuIdentity");
const MenuIdentityLink = require("../src/models/MenuIdentityLink");
const MenuIdentitySuggestion = require("../src/models/MenuIdentitySuggestion");

// Models to scan - ensure they are registered
const MODELS_LIST = [
  "MenuProduct", "MenuOption", "MenuCategory",
  "BuilderProtein", "BuilderCarb", "SaladIngredient", "Addon", "Sandwich"
];

// Explicitly require models to register them with mongoose
MODELS_LIST.forEach(m => {
  try {
    require(`../src/models/${m}`);
  } catch (e) {
    // Some models might not exist or have different paths in some environments
  }
});

const MODELS = {
  one_time: ["MenuProduct", "MenuOption", "MenuCategory"],
  subscription: ["BuilderProtein", "BuilderCarb", "SaladIngredient", "Addon", "Sandwich"],
};

// Common aliases/synonyms
const ALIAS_DICTIONARY = [
  ["جمبري", "روبيان", "shrimp", "prawns"],
  ["سالمون", "سلمون", "salmon"],
  ["ارز", "رز", "rice"],
];

const CANONICAL_ALIASES = {};
for (const group of ALIAS_DICTIONARY) {
  const primary = group[0];
  for (const alias of group) {
    CANONICAL_ALIASES[normalizeAlias(alias)] = normalizeAlias(primary);
  }
}

function getCanonicalToken(name) {
  const norm = normalizeAlias(name);
  if (!norm) return "";
  if (CANONICAL_ALIASES[norm]) return CANONICAL_ALIASES[norm];
  return norm;
}

async function run() {
  const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!MONGO_URI) {
    console.error("Missing MONGO_URI in environment");
    process.exit(1);
  }

  const shouldClose = mongoose.connection.readyState === 0;
  if (shouldClose) {
    await mongoose.connect(MONGO_URI);
    console.log("Connected to database for suggestion scan...");
  }

  const isWriteMode = process.env.MENU_IDENTITY_SUGGESTIONS_WRITE === "true";
  const isProduction = process.env.NODE_ENV === "production" || MONGO_URI.includes("production") || MONGO_URI.includes("cluster0");

  if (isWriteMode && isProduction && !process.env.I_KNOW_WHAT_I_AM_DOING_PROD_WRITE) {
    console.error("❌ Write mode is disabled on production by default. No changes made.");
    process.exit(1);
  }

  const reportsDir = path.join(__dirname, "..", "output");
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir);
  const reportPath = path.join(reportsDir, "menu-identity-suggestions.json");

  const candidates = [];

  // Scrape One-time
  for (const modelName of MODELS.one_time) {
    try {
      const Model = mongoose.model(modelName);
      const docs = await Model.find({ isActive: { $ne: false } }).lean();
      for (const doc of docs) {
        candidates.push({
          channel: "one_time",
          sourceModel: modelName,
          sourceId: doc._id,
          sourceKey: doc.key,
          nameAr: doc.name?.ar || doc.name,
          nameEn: doc.name?.en || "",
          type: inferType(modelName, doc),
        });
      }
    } catch (e) {
      console.warn(`Could not scan ${modelName}: ${e.message}`);
    }
  }

  // Scrape Subscription
  for (const modelName of MODELS.subscription) {
    try {
      const Model = mongoose.model(modelName);
      const docs = await Model.find({ isActive: { $ne: false } }).lean();
      for (const doc of docs) {
        candidates.push({
          channel: "subscription",
          sourceModel: modelName,
          sourceId: doc._id,
          sourceKey: doc.key,
          nameAr: doc.name?.ar || doc.name,
          nameEn: doc.name?.en || "",
          type: inferType(modelName, doc),
        });
      }
    } catch (e) {
      console.warn(`Could not scan ${modelName}: ${e.message}`);
    }
  }

  console.log(`Found ${candidates.length} candidates across channels.`);

  const suggestions = [];
  const processed = new Set();

  for (let i = 0; i < candidates.length; i++) {
    if (processed.has(i)) continue;
    const c1 = candidates[i];
    const token1Ar = getCanonicalToken(c1.nameAr);
    const token1En = getCanonicalToken(c1.nameEn);

    const matchGroup = [i];
    processed.add(i);

    for (let j = i + 1; j < candidates.length; j++) {
      if (processed.has(j)) continue;
      const c2 = candidates[j];
      const token2Ar = getCanonicalToken(c2.nameAr);
      const token2En = getCanonicalToken(c2.nameEn);

      let confidence = null;
      if (token1Ar && token1Ar === token2Ar) {
        confidence = normalizeAlias(c1.nameAr) === normalizeAlias(c2.nameAr) ? "exact" : "alias";
      } else if (token1En && token1En === token2En) {
        confidence = normalizeAlias(c1.nameEn) === normalizeAlias(c2.nameEn) ? "exact" : "alias";
      }

      if (confidence) {
        matchGroup.push(j);
        processed.add(j);
      }
    }

    if (matchGroup.length > 1) {
      const groupItems = matchGroup.map(idx => candidates[idx]);
      const oneTimeSources = groupItems.filter(it => it.channel === "one_time");
      const subSources = groupItems.filter(it => it.channel === "subscription");

      suggestions.push({
        identityKey: normalizeIdentityKey(c1.nameEn || c1.sourceKey || c1.nameAr),
        identityName: { ar: c1.nameAr, en: c1.nameEn },
        type: c1.type,
        oneTimeSources: oneTimeSources.map(s => ({ model: s.sourceModel, id: s.sourceId, key: s.sourceKey, name: s.nameAr })),
        subscriptionSources: subSources.map(s => ({ model: s.sourceModel, id: s.sourceId, key: s.sourceKey, name: s.nameAr })),
        confidence: groupItems.every(it => normalizeAlias(it.nameAr) === token1Ar) ? "exact" : "alias",
        reason: "Matched across channels by name/alias",
        warnings: groupItems.length > 2 ? ["Multiple records matched this group"] : []
      });
    }
  }

  console.log(`Suggested ${suggestions.length} identity groupings.`);
  fs.writeFileSync(reportPath, JSON.stringify(suggestions, null, 2));
  console.log(`Report generated at ${reportPath}`);

  if (isWriteMode) {
    console.log("Writing suggestions to staging table (MenuIdentitySuggestion)...");
    let createdSuggestions = 0;

    for (const sug of suggestions) {
      try {
        const existing = await MenuIdentitySuggestion.findOne({
          identityKey: sug.identityKey,
          status: "pending"
        });

        if (!existing) {
          await MenuIdentitySuggestion.create({
            identityKey: sug.identityKey,
            identityName: sug.identityName,
            type: sug.type,
            proposedLinks: [
              ...sug.oneTimeSources.map(s => ({ ...s, channel: "one_time", sourceModel: s.model, sourceId: s.id, sourceKey: s.key, sourceDisplayName: s.name })),
              ...sug.subscriptionSources.map(s => ({ ...s, channel: "subscription", sourceModel: s.model, sourceId: s.id, sourceKey: s.key, sourceDisplayName: s.name }))
            ],
            confidence: sug.confidence,
            reason: sug.reason,
            warnings: sug.warnings,
            status: "pending"
          });
          createdSuggestions++;
        }
      } catch (err) {
        console.error(`Failed to write suggestion for ${sug.identityKey}: ${err.message}`);
      }
    }
    console.log(`Successfully created ${createdSuggestions} pending suggestions.`);
  } else {
    console.log("Dry-run only. No staging records created. Use MENU_IDENTITY_SUGGESTIONS_WRITE=true to apply.");
  }
}

function inferType(modelName, doc) {
  if (modelName.includes("Product") || modelName.includes("Sandwich")) return "product";
  if (modelName.includes("Protein")) return "protein";
  if (modelName.includes("Carb")) return "carb";
  if (modelName.includes("Ingredient") || modelName.includes("Option") || modelName.includes("Addon")) return "addon";
  if (modelName.includes("Category")) return "category";
  return "other";
}

if (require.main === module) {
  run()
    .then(() => mongoose.disconnect())
    .catch(err => {
      console.error("Script failed:", err);
      mongoose.disconnect().finally(() => process.exit(1));
    });
}

module.exports = { run, getCanonicalToken, inferType };
