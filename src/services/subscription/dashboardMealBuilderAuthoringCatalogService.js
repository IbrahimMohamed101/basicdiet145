"use strict";

const baseCatalogService = require("./dashboardMealBuilderCatalogService");
const {
  resolveProteinVisualFamilyKey,
} = require("../../config/mealPlannerContract");

const AUTHORING_CONTRACT_VERSION = "dashboard_meal_builder_authoring.v1";
const STANDARD_SELECTION_TYPE = "standard_meal";

function stringId(value) {
  return value === undefined || value === null || value === ""
    ? null
    : String(value);
}

function groupRole(group = {}) {
  const explicit = String(
    group.optionRole || group.role || group.metadata?.optionRole || ""
  )
    .trim()
    .toLowerCase();
  if (explicit === "protein" || explicit === "carbs") return explicit;

  const key = String(group.key || "").trim().toLowerCase();
  const ar = String(group.name?.ar || "").trim().toLowerCase();
  const en = String(group.name?.en || "").trim().toLowerCase();
  const source = `${key} ${ar} ${en}`;
  if (
    source.includes("carb") ||
    source.includes("كارب") ||
    source.includes("نشويات")
  ) {
    return "carbs";
  }
  if (source.includes("protein") || source.includes("بروتين")) {
    return "protein";
  }
  return null;
}

function isPremiumOption(option = {}) {
  const selectionType = String(option.selectionType || "")
    .trim()
    .toLowerCase();
  return Boolean(
    String(option.premiumKey || "").trim() ||
      selectionType === "premium_meal" ||
      selectionType === "premium_large_salad"
  );
}

function optionFromNode(node = {}) {
  const option = node.option || node;
  const id = stringId(option.id || option._id || option.optionId);
  if (!id) return null;
  const relationStatus = node.relationStatus || option.relationStatus || {};
  const status = option.status || {};
  const effectiveStatus = node.effectiveStatus || {
    active: relationStatus.active !== false && status.active !== false,
    visible: relationStatus.visible !== false && status.visible !== false,
    available: relationStatus.available !== false && status.available !== false,
    customerReady:
      relationStatus.effective !== false && status.customerReady !== false,
  };
  const premium = isPremiumOption(option);
  const familyKey = String(resolveProteinVisualFamilyKey(option) || "")
    .trim()
    .toLowerCase();

  return {
    ...option,
    id,
    _id: id,
    optionId: id,
    type: "option",
    relation: node.relation || option.relation || null,
    relationStatus,
    effectiveStatus,
    pricing: node.pricing || option.pricing || null,
    proteinFamilyKey: option.proteinFamilyKey || familyKey,
    displayCategoryKey: option.displayCategoryKey || familyKey,
    familyKey,
    isPremium: premium,
    selectionType: premium
      ? option.selectionType || "premium_meal"
      : STANDARD_SELECTION_TYPE,
    linked: Boolean(node.relation || option.relation || relationStatus.exists !== false),
    relationExists: Boolean(
      node.relation || option.relation || relationStatus.exists !== false
    ),
    assignable:
      !premium &&
      effectiveStatus.customerReady === true &&
      relationStatus.effective !== false,
    eligible:
      !premium &&
      effectiveStatus.customerReady === true &&
      relationStatus.effective !== false,
  };
}

function builderGroupReasonCodes({
  productStatus,
  groupStatus,
  relationStatus,
  optionRole,
  options,
}) {
  const reasonCodes = [];
  if (productStatus?.customerReady !== true) {
    reasonCodes.push(
      ...(productStatus?.reasonCodes || ["PRODUCT_NOT_READY"])
    );
  }
  if (groupStatus?.customerReady !== true) {
    reasonCodes.push(...(groupStatus?.reasonCodes || ["OPTION_GROUP_NOT_READY"]));
  }
  if (relationStatus?.effective !== true) {
    reasonCodes.push("PRODUCT_GROUP_RELATION_UNAVAILABLE");
  }
  if (!optionRole) reasonCodes.push("UNSUPPORTED_OPTION_GROUP_ROLE");
  if (!options.some((option) => option.assignable === true)) {
    reasonCodes.push("NO_ASSIGNABLE_STANDARD_OPTIONS");
  }
  return [...new Set(reasonCodes)];
}

function buildBuilderGroups(catalog = {}) {
  const rows = [];
  for (const product of catalog.products || []) {
    const productId = stringId(product.id || product._id || product.productId);
    if (!productId) continue;
    for (const entry of product.optionGroups || []) {
      const group = entry.group || entry;
      const groupId = stringId(group?.id || group?._id || entry.groupId || entry.id);
      if (!groupId || !group) continue;
      const optionRole = groupRole(group);
      const options = (entry.options || []).map(optionFromNode).filter(Boolean);
      const standardOptions = options.filter((option) => option.isPremium !== true);
      const families = [
        ...new Set(
          standardOptions
            .map((option) => String(option.familyKey || "").trim().toLowerCase())
            .filter(Boolean)
        ),
      ];
      const relationStatus = entry.relationStatus || {};
      const groupStatus = entry.groupStatus || group.status || {};
      const effectiveStatus = entry.effectiveStatus || {};
      const reasonCodes = builderGroupReasonCodes({
        productStatus: product.status,
        groupStatus,
        relationStatus,
        optionRole,
        options: standardOptions,
      });
      const eligible = reasonCodes.length === 0;

      rows.push({
        id: `${productId}:${groupId}`,
        cardType: "option_family",
        productContextId: productId,
        sourceGroupId: groupId,
        optionRole,
        selectionType: STANDARD_SELECTION_TYPE,
        product: {
          id: productId,
          key: product.key || "",
          name: product.name || { ar: "", en: "" },
          label: product.label || product.labelAr || product.labelEn || "",
          status: product.status || {},
          mealPlanner: product.mealPlanner || {},
        },
        group: {
          ...group,
          id: groupId,
          _id: groupId,
          status: groupStatus,
        },
        relation: entry.relation || null,
        relationStatus,
        effectiveStatus,
        rules: entry.rules || {},
        families,
        options: standardOptions,
        optionCount: standardOptions.length,
        assignableOptionCount: standardOptions.filter(
          (option) => option.assignable === true
        ).length,
        compatible: Boolean(optionRole),
        eligible,
        reasonCodes,
        sortOrder: Number(
          entry.relation?.sortOrder ?? group.sortOrder ?? product.sortOrder ?? 0
        ),
      });
    }
  }

  return rows.sort(
    (left, right) =>
      Number(right.eligible) - Number(left.eligible) ||
      Number(left.product?.key !== "basic_meal") -
        Number(right.product?.key !== "basic_meal") ||
      Number(left.sortOrder || 0) - Number(right.sortOrder || 0) ||
      String(left.group?.key || "").localeCompare(
        String(right.group?.key || "")
      )
  );
}

async function getCompleteCatalog(options = {}) {
  const catalog = await baseCatalogService.getCompleteCatalog(options);
  const builderGroups = buildBuilderGroups(catalog);
  return {
    ...catalog,
    authoringContractVersion: AUTHORING_CONTRACT_VERSION,
    authoring: {
      contractVersion: AUTHORING_CONTRACT_VERSION,
      source: "product_option_group_relations",
      canonicalSelectionType: STANDARD_SELECTION_TYPE,
      cardType: "option_family",
      complete: true,
      builderGroups,
      counts: {
        builderGroups: builderGroups.length,
        eligibleBuilderGroups: builderGroups.filter((group) => group.eligible).length,
        builderOptions: builderGroups.reduce(
          (sum, group) => sum + Number(group.optionCount || 0),
          0
        ),
        assignableBuilderOptions: builderGroups.reduce(
          (sum, group) => sum + Number(group.assignableOptionCount || 0),
          0
        ),
      },
    },
    builderGroups,
  };
}

module.exports = {
  ...baseCatalogService,
  AUTHORING_CONTRACT_VERSION,
  buildBuilderGroups,
  getCompleteCatalog,
};
