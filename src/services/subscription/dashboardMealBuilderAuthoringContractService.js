"use strict";

const authoringCatalogService = require("./dashboardMealBuilderAuthoringCatalogService");

const CARD_CONTRACT_VERSION = "dashboard_meal_planner_cards.v2";
const STANDARD_SELECTION_TYPE = "standard_meal";
const DIRECT_SELECTION_TYPE = "full_meal_product";

const CARD_CONTRACT = Object.freeze({
  contractVersion: CARD_CONTRACT_VERSION,
  canonicalSelectionTypes: {
    directProduct: DIRECT_SELECTION_TYPE,
    optionMeal: STANDARD_SELECTION_TYPE,
    deprecatedAliases: ["sandwich"],
  },
  premiumCard: {
    cardType: "system_premium",
    fixed: true,
    managedBy: "premium_upgrade_configs",
    editable: false,
  },
  dynamicCardTypes: [
    {
      cardType: "direct_product",
      entity: "MenuProduct",
      completeByItself: true,
      allowedSelectionTypes: [DIRECT_SELECTION_TYPE],
      deprecatedSelectionTypes: ["sandwich"],
      canonicalSelectionType: DIRECT_SELECTION_TYPE,
      legacyInputPolicy: "normalize_to_full_meal_product",
      requiresBaseProduct: false,
      requiresSourceGroup: false,
      premiumManagedSeparately: true,
      flutterSlotContract: {
        idField: "sandwichId",
        requiresCompanionCard: false,
      },
    },
    {
      cardType: "option_family",
      entity: "MenuOption",
      completeByItself: false,
      allowedSelectionTypes: [STANDARD_SELECTION_TYPE],
      deprecatedSelectionTypes: [],
      selectionType: STANDARD_SELECTION_TYPE,
      canonicalSelectionType: STANDARD_SELECTION_TYPE,
      requiresBaseProduct: true,
      requiresSourceGroup: true,
      premiumManagedSeparately: true,
      allowedOptionRoles: ["protein", "carbs"],
      flutterSlotContracts: {
        protein: {
          idField: "proteinId",
          requiresCompanionCard: true,
        },
        carbs: {
          idField: "carbs[].carbId",
          requiresCompanionCard: true,
        },
      },
    },
  ],
});

function buildSearchFacets(catalog = {}) {
  const builderGroups = catalog.builderGroups || [];
  const productItemTypes = [
    ...new Set(
      (catalog.products || [])
        .map((product) => String(product.itemType || "").trim())
        .filter(Boolean)
    ),
  ];
  const productCardVariants = [
    ...new Set(
      (catalog.products || [])
        .map((product) => String(product.ui?.cardVariant || "").trim())
        .filter(Boolean)
    ),
  ];
  const proteinFamilies = [
    ...new Set(
      builderGroups
        .filter((group) => group.optionRole === "protein")
        .flatMap((group) => group.families || [])
        .map(String)
        .filter(Boolean)
    ),
  ];
  const displayCategories = [
    ...new Set(
      (catalog.options || [])
        .map((option) => String(option.displayCategoryKey || "").trim())
        .filter(Boolean)
    ),
  ];
  const optionSelectionTypes = [
    ...new Set(
      (catalog.options || [])
        .map((option) => String(option.selectionType || "").trim())
        .filter(Boolean)
    ),
  ];

  return {
    productCategories: catalog.categories || [],
    productItemTypes,
    productCardVariants,
    optionGroups: catalog.optionGroups || [],
    proteinFamilies,
    displayCategories,
    optionSelectionTypes,
    optionRoles: ["protein", "carbs"],
    cardTypes: ["direct_product", "option_family"],
  };
}

async function getCompleteCatalog(options = {}) {
  const catalog = await authoringCatalogService.getCompleteCatalog(options);
  const searchFacets = buildSearchFacets(catalog);
  return {
    ...catalog,
    cardContract: CARD_CONTRACT,
    searchFacets,
    authoring: {
      ...(catalog.authoring || {}),
      cardContract: CARD_CONTRACT,
      searchFacets,
    },
  };
}

function getCardContract() {
  return JSON.parse(JSON.stringify(CARD_CONTRACT));
}

module.exports = {
  ...authoringCatalogService,
  CARD_CONTRACT_VERSION,
  buildSearchFacets,
  getCardContract,
  getCompleteCatalog,
};
