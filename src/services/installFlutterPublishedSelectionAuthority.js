"use strict";

const crypto = require("crypto");
const {
  MEAL_SELECTION_TYPES,
  buildProteinOptionSections,
} = require("../config/mealPlannerContract");
const mealBuilderConfigService = require("./subscription/mealBuilderConfigService");

const STATE_KEY = Symbol.for(
  "basicdiet.flutterPublishedSelectionAuthority.state"
);
const WRAPPER_MARKER = "__flutterPublishedSelectionAuthority";
const DIRECT_SECTION_TYPES = new Set(["product_list", "product_category"]);
const OPTION_SECTION_TYPES = new Set(["option_group", "option_family"]);

function token(value) {
  return String(value || "").trim().toLowerCase();
}

function itemId(value = {}) {
  return String(
    value.id || value.productId || value.optionId || value._id || ""
  ).trim();
}

function sectionKey(section = {}) {
  return token(section.key || section.sectionKey || section.selectionType);
}

function sectionType(section = {}) {
  return token(section.sectionType || section.type);
}

function stringIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean))];
}

function selectedProductIds(section = {}) {
  return stringIds(section.selectedProductIds || section.productIds);
}

function selectedOptionIds(section = {}) {
  return stringIds(section.selectedOptionIds || section.optionIds);
}

function isDirectSection(section = {}) {
  return DIRECT_SECTION_TYPES.has(sectionType(section));
}

function isOptionSection(section = {}) {
  return OPTION_SECTION_TYPES.has(sectionType(section));
}

function usesPublishedSelection(section = {}) {
  const metadata = section.metadata || {};
  const cardType = token(section.cardType || metadata.cardType);
  return (
    token(section.includeMode || "selected") === "selected" ||
    metadata.configuredExplicitly === true ||
    metadata.dashboardManaged === true ||
    cardType === "direct_product" ||
    cardType === "option_family" ||
    cardType === "system_premium"
  );
}

function descriptorMap(config = {}) {
  return new Map(
    (Array.isArray(config.sections) ? config.sections : [])
      .filter((section) => sectionKey(section))
      .map((section) => [sectionKey(section), section])
  );
}

function filterOptionGroup(group = {}, descriptor = {}, lang = "en") {
  const productId = String(descriptor.productContextId || "");
  const groupId = String(descriptor.sourceGroupId || "");
  const currentGroupId = String(group.id || group.groupId || "");
  if (!productId || !groupId || currentGroupId !== groupId) return group;

  const allowed = new Set(selectedOptionIds(descriptor));
  const options = (Array.isArray(group.options) ? group.options : []).filter(
    (option) => allowed.has(itemId(option))
  );
  const next = { ...group, options };

  if (Array.isArray(group.optionSections)) {
    const rebuilt = buildProteinOptionSections(options, lang);
    if (rebuilt.length) next.optionSections = rebuilt;
    else delete next.optionSections;
  }
  return next;
}

function pruneOptionSection(catalogSection = {}, descriptor = {}, lang = "en") {
  if (!usesPublishedSelection(descriptor)) return catalogSection;
  const productId = String(descriptor.productContextId || "");
  const products = (Array.isArray(catalogSection.products)
    ? catalogSection.products
    : []
  ).map((product) => {
    if (productId && itemId(product) !== productId) return product;
    return {
      ...product,
      optionGroups: (Array.isArray(product.optionGroups)
        ? product.optionGroups
        : []
      ).map((group) => filterOptionGroup(group, descriptor, lang)),
    };
  });
  return { ...catalogSection, products };
}

function pruneDirectSection(catalogSection = {}, descriptor = {}) {
  if (!usesPublishedSelection(descriptor)) return catalogSection;
  const allowed = new Set(selectedProductIds(descriptor));
  return {
    ...catalogSection,
    products: (Array.isArray(catalogSection.products)
      ? catalogSection.products
      : []
    ).filter((product) => allowed.has(itemId(product))),
  };
}

function rehashCatalog(catalog = {}) {
  const stablePayload = { ...catalog };
  delete stablePayload.catalogHash;
  return {
    ...catalog,
    catalogHash: `sha256:${crypto
      .createHash("sha256")
      .update(JSON.stringify(stablePayload))
      .digest("hex")}`,
  };
}

function pruneCatalogToPublishedSelections(catalog, config, lang = "en") {
  if (!catalog || !config || !Array.isArray(catalog.sections)) return catalog;
  const descriptors = descriptorMap(config);
  const sections = catalog.sections.map((catalogSection) => {
    const descriptor = descriptors.get(sectionKey(catalogSection));
    if (!descriptor) return catalogSection;
    if (isDirectSection(descriptor)) {
      return pruneDirectSection(catalogSection, descriptor);
    }
    if (isOptionSection(descriptor)) {
      return pruneOptionSection(catalogSection, descriptor, lang);
    }
    return catalogSection;
  });

  return rehashCatalog({
    ...catalog,
    sections,
    selectionAuthority: "published_meal_builder_selected_ids",
  });
}

function canonicalDirectSelectionType(section = {}) {
  const configured = token(section.selectionType);
  return configured === MEAL_SELECTION_TYPES.SANDWICH
    ? MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT
    : configured || MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT;
}

function configuredMembership(config = {}) {
  const directProductsByType = new Map();
  const optionsByType = new Map();

  for (const section of Array.isArray(config.sections) ? config.sections : []) {
    if (!usesPublishedSelection(section)) continue;
    if (isDirectSection(section)) {
      const type = canonicalDirectSelectionType(section);
      if (!directProductsByType.has(type)) directProductsByType.set(type, new Set());
      const target = directProductsByType.get(type);
      for (const id of selectedProductIds(section)) target.add(id);
      continue;
    }
    if (isOptionSection(section)) {
      const type = token(section.selectionType);
      const productId = String(section.productContextId || "");
      const groupId = String(section.sourceGroupId || "");
      if (!type || !productId || !groupId) continue;
      if (!optionsByType.has(type)) optionsByType.set(type, new Set());
      const target = optionsByType.get(type);
      for (const optionId of selectedOptionIds(section)) {
        target.add(`${productId}:${groupId}:${optionId}`);
      }
    }
  }

  return { directProductsByType, optionsByType };
}

function filterSet(current, allowed) {
  if (!(current instanceof Set)) return current;
  return new Set([...current].filter((value) => allowed.has(String(value))));
}

function rebuildGlobalMembership(membership = {}) {
  if (!(membership.bySelectionType instanceof Map)) return membership;
  const products = new Set();
  const groups = new Set();
  const options = new Set();
  for (const scoped of membership.bySelectionType.values()) {
    for (const value of scoped?.products || []) products.add(String(value));
    for (const value of scoped?.groups || []) groups.add(String(value));
    for (const value of scoped?.options || []) options.add(String(value));
  }
  return { ...membership, products, groups, options };
}

function pruneMembershipToPublishedSelections(result, config) {
  if (!result?.membership || !config) return result;
  const membership = result.membership;
  if (!(membership.bySelectionType instanceof Map)) return result;

  const { directProductsByType, optionsByType } = configuredMembership(config);
  const bySelectionType = new Map(membership.bySelectionType);

  for (const [type, allowed] of directProductsByType.entries()) {
    const scoped = bySelectionType.get(type);
    if (!scoped) continue;
    bySelectionType.set(type, {
      ...scoped,
      products: filterSet(scoped.products, allowed),
    });
  }
  for (const [type, allowed] of optionsByType.entries()) {
    const scoped = bySelectionType.get(type);
    if (!scoped) continue;
    bySelectionType.set(type, {
      ...scoped,
      options: filterSet(scoped.options, allowed),
    });
  }

  return {
    ...result,
    membership: rebuildGlobalMembership({ ...membership, bySelectionType }),
  };
}

function wrapCatalogBuilder() {
  const original = mealBuilderConfigService.buildPlannerCatalogFromPublishedBuilder;
  if (typeof original !== "function") {
    throw new Error("Missing published Meal Builder catalog function");
  }
  if (original[WRAPPER_MARKER]) return;

  const wrapped = async function publishedSelectionCatalog(args = {}) {
    const catalog = await original.call(mealBuilderConfigService, args);
    if (!catalog) return catalog;
    const config =
      args.config || (await mealBuilderConfigService.getCurrentPublishedConfig());
    return pruneCatalogToPublishedSelections(catalog, config, args.lang || "en");
  };
  Object.defineProperty(wrapped, WRAPPER_MARKER, { value: true });
  Object.defineProperty(wrapped, "__original", { value: original });
  mealBuilderConfigService.buildPlannerCatalogFromPublishedBuilder = wrapped;
}

function wrapMembershipBuilder() {
  const original = mealBuilderConfigService.buildPublishedMembership;
  if (typeof original !== "function") {
    throw new Error("Missing published Meal Builder membership function");
  }
  if (original[WRAPPER_MARKER]) return;

  const wrapped = async function publishedSelectionMembership(...args) {
    const result = await original.apply(mealBuilderConfigService, args);
    const config = await mealBuilderConfigService.getCurrentPublishedConfig();
    return pruneMembershipToPublishedSelections(result, config);
  };
  Object.defineProperty(wrapped, WRAPPER_MARKER, { value: true });
  Object.defineProperty(wrapped, "__original", { value: original });
  mealBuilderConfigService.buildPublishedMembership = wrapped;
}

function installFlutterPublishedSelectionAuthority() {
  const current = globalThis[STATE_KEY];
  if (current?.status === "installed") return current;

  const state = { status: "installing", installedAt: null };
  globalThis[STATE_KEY] = state;
  try {
    wrapCatalogBuilder();
    wrapMembershipBuilder();
    Object.assign(state, {
      status: "installed",
      installedAt: new Date(),
      selectionAuthority: "published_meal_builder_selected_ids",
      directProductsSelectedOnly: true,
      optionsSelectedOnly: true,
      membershipSelectedOnly: true,
    });
    return state;
  } catch (error) {
    state.status = "failed";
    state.errorCode =
      error?.code || "FLUTTER_PUBLISHED_SELECTION_AUTHORITY_INSTALL_FAILED";
    state.errorMessage = error?.message || String(error);
    throw error;
  }
}

installFlutterPublishedSelectionAuthority();

module.exports = {
  STATE_KEY,
  configuredMembership,
  installFlutterPublishedSelectionAuthority,
  pruneCatalogToPublishedSelections,
  pruneMembershipToPublishedSelections,
  usesPublishedSelection,
};
