const BuilderProtein = require("../../models/BuilderProtein");
const {
  resolvePremiumUpgrade,
} = require("../../services/subscription/premiumUpgradeConfigService");

const PREMIUM_LARGE_SALAD_KEY = "premium_large_salad";
const LEGACY_CUSTOM_PREMIUM_SALAD_KEY = "custom_premium_salad";

const PREMIUM_ITEM_KEY_ALIASES = Object.freeze({
  [LEGACY_CUSTOM_PREMIUM_SALAD_KEY]: PREMIUM_LARGE_SALAD_KEY,
  [PREMIUM_LARGE_SALAD_KEY]: PREMIUM_LARGE_SALAD_KEY,
});

const CANONICAL_PREMIUM_KEYS = ["shrimp", "beef_steak", "salmon", PREMIUM_LARGE_SALAD_KEY];

const STATIC_PREMIUM_ITEMS = {
  [PREMIUM_LARGE_SALAD_KEY]: {
    premiumKey: PREMIUM_LARGE_SALAD_KEY,
    name: { en: "Premium Large Salad", ar: "سلطة كبيرة مميزة" },
    type: PREMIUM_LARGE_SALAD_KEY,
    currency: "SAR",
  },
};

function normalizePremiumItemKey(key) {
  if (!key || typeof key !== "string") return key;
  const trimmed = key.trim();
  return PREMIUM_ITEM_KEY_ALIASES[trimmed] || trimmed;
}

function isStaticPremiumItem(premiumKey) {
  return normalizePremiumItemKey(premiumKey) === PREMIUM_LARGE_SALAD_KEY;
}

function getStaticPremiumItem(premiumKey) {
  return STATIC_PREMIUM_ITEMS[normalizePremiumItemKey(premiumKey)] || null;
}

async function resolveStaticPremiumItem(premiumKey) {
  const normalizedKey = normalizePremiumItemKey(premiumKey);
  if (normalizedKey !== PREMIUM_LARGE_SALAD_KEY) return null;
  const upgrade = await resolvePremiumUpgrade(normalizedKey);

  return {
    premiumKey: PREMIUM_LARGE_SALAD_KEY,
    name: { en: "Premium Large Salad", ar: "سلطة كبيرة مميزة" },
    type: PREMIUM_LARGE_SALAD_KEY,
    extraFeeHalala: upgrade.priceHalala,
    currency: upgrade.currency,
    priceSource: "resolvePremiumUpgrade",
    productId: upgrade.sourceProductId ? String(upgrade.sourceProductId) : null,
    productKey: normalizedKey,
  };
}

const PREMIUM_KEY_NAME_MAP = {
  shrimp: ["جمبري", "shrimp", "gambari", "جمبرى"],
  beef_steak: ["ستيك لحم", "beef steak", "steak", "beefsteak", "لحم"],
  salmon: ["سالمون", "salmon", "سمك سالمون", "سلمون"],
};

function normalizeName(value) {
  if (!value || typeof value !== "string") return "";
  return value.toLowerCase().trim().replace(/\s+/g, " ");
}

function resolvePremiumKeyFromName(name) {
  if (!name || typeof name !== "string") return null;
  const normalized = normalizeName(name);

  for (const [key, aliases] of Object.entries(PREMIUM_KEY_NAME_MAP)) {
    for (const alias of aliases) {
      if (normalized.includes(alias) || alias.includes(normalized)) {
        return key;
      }
    }
  }

  if (normalized.includes("جمبرى") || normalized.includes("shrimp") || normalized.includes("gambari")) {
    return "shrimp";
  }
  if (normalized.includes("ستيك") || normalized.includes("steak") || normalized.includes("beef")) {
    return "beef_steak";
  }
  if (normalized.includes("سالمون") || normalized.includes("salmon") || normalized.includes("سلمون")) {
    return "salmon";
  }

  return null;
}

function isCanonicalPremiumKey(key) {
  return key && CANONICAL_PREMIUM_KEYS.includes(normalizePremiumItemKey(key));
}

async function resolveCanonicalPremiumIdentity(input) {
  const {
    premiumMealId,
    proteinId,
    builderProteinDoc,
    name,
    premiumKey: inputPremiumKey,
  } = input;
  const normalizedInputPremiumKey = normalizePremiumItemKey(inputPremiumKey);

  const debugEnabled = process.env.DEBUG_PREMIUM_RESOLUTION === "true";
  const log = (source, details = {}) => {
    if (!debugEnabled) return;
    console.log(`[PREMIUM_RESOLUTION] from=${source}`, {
      premiumMealId,
      proteinId: proteinId ? String(proteinId) : null,
      name,
      inputPremiumKey: normalizedInputPremiumKey,
      ...details,
    });
  };

  let resolvedPremiumKey = null;
  let resolvedName = name || null;
  let resolvedUnitExtraFeeHalala = 0;
  let canonicalProteinDoc = null;
  let canonicalProteinId = null;
  let resolutionSource = null;

  if (normalizedInputPremiumKey && isCanonicalPremiumKey(normalizedInputPremiumKey)) {
    resolvedPremiumKey = normalizedInputPremiumKey;
    resolutionSource = "inputPremiumKey";
    log(resolutionSource, { resolvedPremiumKey });
  }

  if (!resolvedPremiumKey && builderProteinDoc) {
    if (builderProteinDoc.premiumKey && isCanonicalPremiumKey(builderProteinDoc.premiumKey)) {
      resolvedPremiumKey = normalizePremiumItemKey(builderProteinDoc.premiumKey);
      resolutionSource = "builderProteinDoc.premiumKey";
      log(resolutionSource, { resolvedPremiumKey });
    } else if (!builderProteinDoc.premiumKey) {
      const inferredKey = resolvePremiumKeyFromName(
        builderProteinDoc.name?.en || builderProteinDoc.name?.ar || ""
      );
      if (inferredKey) {
        resolvedPremiumKey = inferredKey;
        resolutionSource = "builderProteinDoc.name.inferred";
        log(resolutionSource, { resolvedPremiumKey });
      }
    }
    if (builderProteinDoc.name) {
      resolvedName = builderProteinDoc.name.en || builderProteinDoc.name.ar || null;
    }
    resolvedUnitExtraFeeHalala = Number(builderProteinDoc.extraFeeHalala || 0);
  }

  if (!resolvedPremiumKey && proteinId) {
    // Normalize to null if proteinId is an empty/invalid string
    const proteinIdStr = String(proteinId).trim();
    const effectiveProteinId = (proteinIdStr && proteinIdStr !== "null" && proteinIdStr !== "undefined") ? proteinId : null;

    if (effectiveProteinId) {
      try {
        const proteinDoc = await BuilderProtein.findById(effectiveProteinId).lean();
        if (proteinDoc) {
          if (proteinDoc.premiumKey && isCanonicalPremiumKey(proteinDoc.premiumKey)) {
            resolvedPremiumKey = normalizePremiumItemKey(proteinDoc.premiumKey);
            resolutionSource = "proteinId.premiumKey";
            log(resolutionSource, { resolvedPremiumKey });
          } else if (!proteinDoc.premiumKey) {
            const inferredKey = resolvePremiumKeyFromName(
              proteinDoc.name?.en || proteinDoc.name?.ar || ""
            );
            if (inferredKey) {
              resolvedPremiumKey = inferredKey;
              resolutionSource = "proteinId.name.inferred";
              log(resolutionSource, { resolvedPremiumKey });
            }
          }
          if (!resolvedName && proteinDoc.name) {
            resolvedName = proteinDoc.name.en || proteinDoc.name.ar || null;
          }
          if (resolvedUnitExtraFeeHalala === 0) {
            resolvedUnitExtraFeeHalala = Number(proteinDoc.extraFeeHalala || 0);
          }
        }
      } catch (err) {
        log("proteinId.error", { error: err.message });
      }
    }
  }

  if (!resolvedPremiumKey && name) {
    const inferredKey = resolvePremiumKeyFromName(name);
    if (inferredKey) {
      resolvedPremiumKey = inferredKey;
      resolutionSource = "name.inferred";
      log(resolutionSource, { resolvedPremiumKey });
    }
  }

  if (resolvedPremiumKey) {
    const upgrade = await resolvePremiumUpgrade(resolvedPremiumKey);
    resolvedUnitExtraFeeHalala = upgrade.priceHalala;
    resolutionSource = "resolvePremiumUpgrade";
    log("resolvePremiumUpgrade", { resolvedUnitExtraFeeHalala });

    if (isStaticPremiumItem(resolvedPremiumKey)) {
      const staticItem = await resolveStaticPremiumItem(resolvedPremiumKey);
      if (staticItem) {
        resolvedName = staticItem.name.en || staticItem.name.ar || null;
        log(resolutionSource, {
          resolvedPremiumKey,
          resolvedName,
          resolvedUnitExtraFeeHalala,
        });
      }
    } else {
      canonicalProteinDoc = await BuilderProtein.findOne({
        premiumKey: resolvedPremiumKey,
        isPremium: true,
        isActive: true,
      }).lean();

      if (canonicalProteinDoc) {
        canonicalProteinId = canonicalProteinDoc._id;
        if (!resolvedName && canonicalProteinDoc.name) {
          resolvedName = canonicalProteinDoc.name.en || canonicalProteinDoc.name.ar || null;
        }
        log("canonicalProtein.found", {
          canonicalProteinId: String(canonicalProteinId),
          resolvedName,
          resolvedUnitExtraFeeHalala,
        });
      } else if (!isStaticPremiumItem(resolvedPremiumKey)) {
        const err = new Error(`No active canonical protein found for premiumKey: ${resolvedPremiumKey}`);
        err.code = "INVALID_PREMIUM_ITEM";
        throw err;
      }
    }
  }

  if (!resolvedPremiumKey) {
    const err = new Error(
      `Cannot resolve premium identity for: premiumMealId=${premiumMealId}, proteinId=${proteinId}, name=${name}`
    );
    err.code = "INVALID_PREMIUM_ITEM";
    throw err;
  }

  return {
    premiumKey: resolvedPremiumKey,
    canonicalProteinId,
    canonicalProteinDoc,
    name: resolvedName,
    unitExtraFeeHalala: resolvedUnitExtraFeeHalala,
    currency: "SAR",
    type: isStaticPremiumItem(resolvedPremiumKey) ? resolvedPremiumKey : "protein",
    resolutionSource,
  };
}

function getPremiumDisplayName({ premiumKey, name, lang = "en" }) {
  if (name && String(name).trim() && name !== premiumKey) {
    return String(name).trim();
  }

  const normalizedPremiumKey = normalizePremiumItemKey(premiumKey);

  if (normalizedPremiumKey === PREMIUM_LARGE_SALAD_KEY) {
    return lang === "ar"
      ? "سلطة كبيرة مميزة"
      : "Premium Large Salad";
  }

  // Fallback for known canonical keys if name is missing or equal to key
  const fallbacks = {
    shrimp: { en: "Shrimp", ar: "جمبري" },
    beef_steak: { en: "Beef Steak", ar: "ستيك لحم" },
    salmon: { en: "Salmon", ar: "سالمون" },
  };

  if (normalizedPremiumKey && fallbacks[normalizedPremiumKey]) {
    return lang === "ar" ? fallbacks[normalizedPremiumKey].ar : fallbacks[normalizedPremiumKey].en;
  }

  return name || premiumKey || "";
}

module.exports = {
  resolveCanonicalPremiumIdentity,
  resolvePremiumKeyFromName,
  isCanonicalPremiumKey,
  CANONICAL_PREMIUM_KEYS,
  LEGACY_CUSTOM_PREMIUM_SALAD_KEY,
  PREMIUM_KEY_NAME_MAP,
  PREMIUM_LARGE_SALAD_KEY,
  PREMIUM_ITEM_KEY_ALIASES,
  normalizeName,
  normalizePremiumItemKey,
  isStaticPremiumItem,
  getStaticPremiumItem,
  resolveStaticPremiumItem,
  STATIC_PREMIUM_ITEMS,
  getPremiumDisplayName,
};
