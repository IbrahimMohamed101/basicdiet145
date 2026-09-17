"use strict";

const VERIFIED_FIXTURE_GROUPS = Object.freeze([
  {
    id: "6a6945c1080fae4ed07964e7",
    key: "pickup_slot_append_1785284024734_mixed_standard_protein_group",
  },
  {
    id: "6a6945c2080fae4ed0796504",
    key: "pickup_slot_append_1785284024734_mixed_premium_protein_group",
  },
  {
    id: "6a6945c3080fae4ed0796512",
    key: "pickup_slot_append_1785284024734_mixed_salad_protein_group",
  },
  {
    id: "6a6945c3080fae4ed079651b",
    key: "pickup_slot_append_1785284024734_mixed_sandwich_protein_group",
  },
]);

const VERIFIED_FIXTURE_PRODUCT_IDS = Object.freeze([
  "6a6945c1080fae4ed07964f3",
  "6a6945c2080fae4ed0796509",
  "6a6945c3080fae4ed0796516",
  "6a6945c4080fae4ed079651e",
]);

const LEGITIMATE_PROTEIN_CONTEXTS = Object.freeze([
  {
    id: "6a62197279ee075a57f70107",
    key: "proteins",
    contextKey: "basic_meal_protein",
    label: { ar: "البروتين — الوجبات الأساسية", en: "Protein — Basic Meal" },
  },
  {
    id: "6a62250f79ee075a57f70223",
    key: "salad_proteins",
    contextKey: "basic_salad_protein",
    label: { ar: "البروتين — السلطة الأساسية", en: "Protein — Basic Salad" },
  },
  {
    id: "6a62252179ee075a57f70263",
    key: "salad_extra_protein",
    contextKey: "basic_salad_extra_protein_50g",
    label: { ar: "إضافات البروتين — 50g", en: "Protein Extras — 50g" },
  },
  {
    id: "6a6227ca79ee075a57f7029f",
    key: "protein",
    contextKey: "premium_large_salad_protein",
    label: { ar: "البروتين — السلطة البريميوم", en: "Protein — Premium Large Salad" },
  },
]);

const fixtureById = new Map(VERIFIED_FIXTURE_GROUPS.map((entry) => [entry.id, entry]));
const contextById = new Map(LEGITIMATE_PROTEIN_CONTEXTS.map((entry) => [entry.id, entry]));

function stringId(value) {
  return String(value?._id || value?.id || value || "").trim();
}

function isVerifiedFixtureGroup(group) {
  const expected = fixtureById.get(stringId(group));
  return Boolean(expected && String(group?.key || "") === expected.key);
}

function isVerifiedFixtureGroupId(value) {
  return fixtureById.has(stringId(value));
}

function dashboardClassification(group) {
  if (isVerifiedFixtureGroup(group)) {
    return {
      classification: "quarantined_test_fixture",
      canonicalRole: "protein",
      contextKey: "integration_test_fixture",
      label: { ar: "مجموعة اختبار معزولة", en: "Quarantined Test Fixture" },
      isQuarantined: true,
      normalEditorVisible: false,
    };
  }

  const expected = contextById.get(stringId(group));
  if (expected && String(group?.key || "") === expected.key) {
    return {
      classification: "legitimate_context_group",
      canonicalRole: "protein",
      contextKey: expected.contextKey,
      label: expected.label,
      isQuarantined: false,
      normalEditorVisible: true,
    };
  }

  return {
    classification: "catalog_group",
    canonicalRole: null,
    contextKey: null,
    label: null,
    isQuarantined: false,
    normalEditorVisible: true,
  };
}

function decorateDashboardGroup(payload, source = payload) {
  if (!payload) return payload;
  const dashboardContext = dashboardClassification(source);
  return {
    ...payload,
    dashboardContext,
    dashboardLabel: dashboardContext.label || payload.name || { ar: "", en: "" },
  };
}

function normalDashboardGroupQuery(includeQuarantined = false) {
  if (includeQuarantined) return {};
  return { _id: { $nin: VERIFIED_FIXTURE_GROUPS.map((entry) => entry.id) } };
}

function normalDashboardProductQuery(includeQuarantined = false) {
  if (includeQuarantined) return {};
  return { _id: { $nin: VERIFIED_FIXTURE_PRODUCT_IDS } };
}

module.exports = {
  LEGITIMATE_PROTEIN_CONTEXTS,
  VERIFIED_FIXTURE_GROUPS,
  VERIFIED_FIXTURE_PRODUCT_IDS,
  dashboardClassification,
  decorateDashboardGroup,
  isVerifiedFixtureGroup,
  isVerifiedFixtureGroupId,
  normalDashboardGroupQuery,
  normalDashboardProductQuery,
};
