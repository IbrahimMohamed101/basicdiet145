"use strict";

const mongoose = require("mongoose");

const MenuOption = require("../models/MenuOption");
const MenuOptionGroup = require("../models/MenuOptionGroup");
const MenuProduct = require("../models/MenuProduct");
const {
  MEAL_SELECTION_TYPES,
} = require("../config/mealPlannerContract");
const mealSlotPlannerService = require("./subscription/mealSlotPlannerService");
const canonicalMealSlotPlannerService = require("./subscription/canonicalMealSlotPlannerService");

const BASIC_MEAL_PRODUCT_KEY = "basic_meal";
const PREMIUM_LARGE_SALAD_PRODUCT_KEY = "premium_large_salad";

const SALAD_GROUP_KEY_ALIASES = Object.freeze({
  leafy_greens: "leafy_greens",
  salad_greens: "leafy_greens",
  vegetables: "vegetables",
  vegetables_legumes: "vegetables",
  salad_vegetables_legumes: "vegetables",
  protein: "protein",
  proteins: "protein",
  salad_proteins: "protein",
  cheese_nuts: "cheese_nuts",
  salad_cheese_nuts: "cheese_nuts",
  fruits: "fruits",
  salad_fruits: "fruits",
  sauce: "sauce",
  sauces: "sauce",
  salad_sauces: "sauce",
  extra_protein_50g: "extra_protein_50g",
  salad_extra_protein: "extra_protein_50g",
});

let installed = false;

function normalizeId(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(normalizeId(value));
}

function canonicalSaladGroupKey(value) {
  const key = String(value || "").trim().toLowerCase();
  return SALAD_GROUP_KEY_ALIASES[key] || key;
}

function isCanonicalSlot(slot) {
  return Boolean(slot && slot.productId && Array.isArray(slot.selectedOptions));
}

function isPremiumLargeSaladSlot(slot) {
  return String(slot && slot.selectionType || "").trim() === MEAL_SELECTION_TYPES.PREMIUM_LARGE_SALAD;
}

function collectLegacyPlannerIds(mealSlots = []) {
  const optionIds = new Set();
  const directProductIds = new Set();

  for (const slot of Array.isArray(mealSlots) ? mealSlots : []) {
    if (!slot || isCanonicalSlot(slot)) continue;

    const selectionType = String(slot.selectionType || "").trim();
    if (
      selectionType === MEAL_SELECTION_TYPES.STANDARD_MEAL
      || selectionType === MEAL_SELECTION_TYPES.PREMIUM_MEAL
    ) {
      if (isValidObjectId(slot.proteinId)) optionIds.add(normalizeId(slot.proteinId));
      for (const carb of Array.isArray(slot.carbs) ? slot.carbs : []) {
        if (isValidObjectId(carb && carb.carbId)) optionIds.add(normalizeId(carb.carbId));
      }
      continue;
    }

    if (selectionType === MEAL_SELECTION_TYPES.PREMIUM_LARGE_SALAD) {
      const groups = slot.salad && slot.salad.groups && typeof slot.salad.groups === "object"
        ? slot.salad.groups
        : {};
      for (const values of Object.values(groups)) {
        for (const value of Array.isArray(values) ? values : []) {
          if (isValidObjectId(value)) optionIds.add(normalizeId(value));
        }
      }
      if (isValidObjectId(slot.proteinId)) optionIds.add(normalizeId(slot.proteinId));
      continue;
    }

    if (
      selectionType === MEAL_SELECTION_TYPES.SANDWICH
      || selectionType === MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT
    ) {
      const productId = normalizeId(slot.productId || slot.sandwichId);
      if (isValidObjectId(productId)) directProductIds.add(productId);
    }
  }

  return {
    optionIds: [...optionIds],
    directProductIds: [...directProductIds],
  };
}

function appendSelectedOption(output, option, { quantity = 1, grams = undefined } = {}) {
  const groupId = normalizeId(option && option.groupId);
  const optionId = normalizeId(option && (option._id || option.id));
  if (!groupId || !optionId) return false;

  output.push({
    groupId,
    optionId,
    optionKey: String(option.key || ""),
    quantity: Number.isInteger(Number(quantity)) && Number(quantity) > 0 ? Number(quantity) : 1,
    ...(grams === undefined || grams === null ? {} : { grams: Number(grams) }),
  });
  return true;
}

function convertLegacyPlannerSlotsToCanonical({
  mealSlots,
  productsByKey,
  productsById,
  optionsById,
  groupsById,
}) {
  const inputSlots = Array.isArray(mealSlots) ? mealSlots : [];
  const output = [];

  for (const rawSlot of inputSlots) {
    const slot = rawSlot && typeof rawSlot === "object" ? rawSlot : {};
    if (isCanonicalSlot(slot)) {
      output.push(slot);
      continue;
    }

    const selectionType = String(slot.selectionType || "").trim();
    const base = {
      slotIndex: Number(slot.slotIndex),
      slotKey: slot.slotKey || undefined,
      selectionType,
      ...(slot.premiumSource ? { premiumSource: slot.premiumSource } : {}),
    };

    if (
      selectionType === MEAL_SELECTION_TYPES.STANDARD_MEAL
      || selectionType === MEAL_SELECTION_TYPES.PREMIUM_MEAL
    ) {
      const product = productsByKey.get(BASIC_MEAL_PRODUCT_KEY);
      const protein = optionsById.get(normalizeId(slot.proteinId));
      if (!product || !protein) return null;

      const selectedOptions = [];
      if (!appendSelectedOption(selectedOptions, protein)) return null;

      for (const carb of Array.isArray(slot.carbs) ? slot.carbs : []) {
        const option = optionsById.get(normalizeId(carb && carb.carbId));
        if (!option || !appendSelectedOption(selectedOptions, option, { grams: carb && carb.grams })) {
          return null;
        }
      }

      output.push({
        ...base,
        productId: normalizeId(product._id || product.id),
        selectedOptions,
      });
      continue;
    }

    if (selectionType === MEAL_SELECTION_TYPES.PREMIUM_LARGE_SALAD) {
      const product = productsByKey.get(PREMIUM_LARGE_SALAD_PRODUCT_KEY);
      const groups = slot.salad && slot.salad.groups && typeof slot.salad.groups === "object"
        ? { ...slot.salad.groups }
        : null;
      if (!product || !groups) return null;

      if ((!Array.isArray(groups.protein) || groups.protein.length === 0) && slot.proteinId) {
        groups.protein = [slot.proteinId];
      }

      const selectedOptions = [];
      for (const [requestGroupKey, values] of Object.entries(groups)) {
        if (!Array.isArray(values)) return null;
        const expectedCanonicalGroupKey = canonicalSaladGroupKey(requestGroupKey);

        for (const value of values) {
          const option = optionsById.get(normalizeId(value));
          const group = option ? groupsById.get(normalizeId(option.groupId)) : null;
          if (!option || !group) return null;

          const actualCanonicalGroupKey = canonicalSaladGroupKey(group.key);
          if (actualCanonicalGroupKey !== expectedCanonicalGroupKey) return null;
          if (!appendSelectedOption(selectedOptions, option)) return null;
        }
      }

      output.push({
        ...base,
        productId: normalizeId(product._id || product.id),
        selectedOptions,
      });
      continue;
    }

    if (
      selectionType === MEAL_SELECTION_TYPES.SANDWICH
      || selectionType === MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT
    ) {
      const productId = normalizeId(slot.productId || slot.sandwichId);
      const product = productsById.get(productId);
      if (!product) return null;

      output.push({
        ...base,
        productId,
        selectedOptions: [],
      });
      continue;
    }

    return null;
  }

  return output;
}

async function applySession(query, session) {
  return session ? query.session(session) : query;
}

async function buildCanonicalBridgePayload({ mealSlots, session = null }) {
  const slots = Array.isArray(mealSlots) ? mealSlots : [];
  if (!slots.some(isPremiumLargeSaladSlot)) return null;

  const { optionIds, directProductIds } = collectLegacyPlannerIds(slots);
  if (optionIds.length === 0) return null;

  const optionRows = await applySession(
    MenuOption.find({ _id: { $in: optionIds } }),
    session
  ).lean();

  // A legacy SaladIngredient/BuilderProtein payload must remain on the original
  // validation path. The bridge is only activated when every referenced option
  // belongs to the canonical MenuOption catalog.
  if (optionRows.length !== optionIds.length) return null;

  const groupIds = [...new Set(optionRows.map((row) => normalizeId(row.groupId)).filter(Boolean))];
  const [groupRows, productRows] = await Promise.all([
    applySession(MenuOptionGroup.find({ _id: { $in: groupIds } }), session).lean(),
    applySession(MenuProduct.find({
      $or: [
        { key: { $in: [BASIC_MEAL_PRODUCT_KEY, PREMIUM_LARGE_SALAD_PRODUCT_KEY] } },
        ...(directProductIds.length ? [{ _id: { $in: directProductIds } }] : []),
      ],
    }), session).lean(),
  ]);

  const productsByKey = new Map(productRows.map((row) => [String(row.key || ""), row]));
  const productsById = new Map(productRows.map((row) => [normalizeId(row._id), row]));
  const optionsById = new Map(optionRows.map((row) => [normalizeId(row._id), row]));
  const groupsById = new Map(groupRows.map((row) => [normalizeId(row._id), row]));

  return convertLegacyPlannerSlotsToCanonical({
    mealSlots: slots,
    productsByKey,
    productsById,
    optionsById,
    groupsById,
  });
}

function installFlutterMealPlannerPayloadCompatibility() {
  if (installed) return;
  installed = true;

  const originalBuildMealSlotDraft = mealSlotPlannerService.buildMealSlotDraft.bind(
    mealSlotPlannerService
  );

  mealSlotPlannerService.buildMealSlotDraft = async function buildCompatibleMealSlotDraft(args = {}) {
    const bridgedMealSlots = await buildCanonicalBridgePayload({
      mealSlots: args.mealSlots,
      session: args.session || null,
    });

    if (!bridgedMealSlots) {
      return originalBuildMealSlotDraft(args);
    }

    return canonicalMealSlotPlannerService.validateCanonicalMealSlots({
      mealSlots: bridgedMealSlots,
      mealsPerDayLimit: args.mealsPerDayLimit,
      maxSlotCount: args.maxSlotCount,
      subscription: args.subscription,
      session: args.session || null,
      forConfirmation: false,
    });
  };
}

installFlutterMealPlannerPayloadCompatibility();

module.exports = {
  BASIC_MEAL_PRODUCT_KEY,
  PREMIUM_LARGE_SALAD_PRODUCT_KEY,
  buildCanonicalBridgePayload,
  canonicalSaladGroupKey,
  collectLegacyPlannerIds,
  convertLegacyPlannerSlotsToCanonical,
  installFlutterMealPlannerPayloadCompatibility,
};
