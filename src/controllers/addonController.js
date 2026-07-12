const Addon = require("../models/Addon");
const { startSafeSession } = require("../utils/mongoTransactionSupport");
const MenuProduct = require("../models/MenuProduct");
const { getRequestLang } = require("../utils/i18n");
const { resolveAddonCatalogEntry } = require("../utils/subscription/subscriptionCatalog");
const validateObjectId = require("../utils/validateObjectId");
const errorResponse = require("../utils/errorResponse");
const { resolveManagedImageFromRequest } = require("../services/adminImageService");
const { writeLog } = require("../utils/log");
const {
  normalizeOptionalString,
  parseBooleanField,
  parseLocalizedFieldFromBody,
} = require("../utils/requestFields");

const SYSTEM_CURRENCY = "SAR";
const ADDON_IMAGE_FOLDER = "addons";
const ADDON_BILLING_MODES = new Set(["flat_once", "per_day", "per_meal"]);
const ADDON_KINDS = new Set(["plan", "item"]);
const ADDON_CATEGORIES = new Set(["juice", "snack", "small_salad"]);
const PLAN_BILLING_MODES = new Set(["per_day", "per_meal"]);
const ITEM_BILLING_MODES = new Set(["flat_once"]);

/**
 * Canonical add-on plan categories for dashboard meta select options.
 * These are the ONLY valid entitlement plan categories.
 * Do not add menu product categories (salads, proteins, sandwiches, etc.) here.
 */
const ADDON_PLAN_CATEGORIES_META = [
  {
    key: "juice",
    label: { ar: "اشتراك العصير", en: "Juice Subscription" },
    description: { ar: "اختيارات العصائر والمشروبات", en: "Juice and drink entitlement" },
  },
  {
    key: "small_salad",
    label: { ar: "اشتراك السلطة الصغيرة", en: "Small Salad Subscription" },
    description: { ar: "اختيارات السلطة الصغيرة", en: "Small salad entitlement" },
  },
  {
    key: "snack",
    label: { ar: "اشتراك السناك", en: "Snack Subscription" },
    description: { ar: "اختيارات السناك والحلويات الصحية", en: "Snack and healthy dessert entitlement" },
  },
];

/**
 * Regex patterns that identify test, internal, or contract items
 * that must never appear in the default dashboard read model.
 * Applied to name.en and name.ar.
 */
const DASHBOARD_TEST_NAME_PATTERN = /^(dash-contract[-\s]|test[-\s]|dev[-\s]|internal[-\s])/i;

/**
 * Returns an additional MongoDB filter to exclude test/contract/internal add-on
 * items from the default dashboard read model (data.items).
 * Plans are NOT affected — plans are canonical by category and always shown.
 */
function buildDashboardItemsExcludeFilter() {
  return {
    isActive: true,
    "name.en": { $not: DASHBOARD_TEST_NAME_PATTERN },
    "name.ar": { $not: DASHBOARD_TEST_NAME_PATTERN },
  };
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function normalizeName(input) {
  if (typeof input === "string") {
    const en = input.trim();
    if (!en) {
      throw { status: 400, code: "INVALID", message: "name must have at least one non-empty value in ar or en" };
    }
    return { ar: "", en };
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw { status: 400, code: "INVALID", message: "name must be an object with ar/en or a non-empty string" };
  }
  const ar = input.ar === undefined || input.ar === null ? "" : String(input.ar).trim();
  const en = input.en === undefined || input.en === null ? "" : String(input.en).trim();
  if (!ar && !en) {
    throw { status: 400, code: "INVALID", message: "name must have at least one non-empty value in ar or en" };
  }
  return { ar, en };
}

function normalizeLocalizedOptional(input) {
  if (input === undefined || input === null) {
    return { ar: "", en: "" };
  }
  if (typeof input === "string") {
    return { ar: "", en: input.trim() };
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw { status: 400, code: "INVALID", message: "description must be an object with ar/en or a string" };
  }
  return {
    ar: input.ar === undefined || input.ar === null ? "" : String(input.ar).trim(),
    en: input.en === undefined || input.en === null ? "" : String(input.en).trim(),
  };
}

function normalizeSortOrder(value, fieldName = "sortOrder") {
  const parsed = Number(value);
  if (!isNonNegativeInteger(parsed)) {
    throw { status: 400, code: "INVALID", message: `${fieldName} must be an integer >= 0` };
  }
  return parsed;
}

async function writeAddonActivityLogSafely(req, addon, action, meta = {}) {
  if (!req || !req.dashboardUserId || !addon || !addon._id) return;
  try {
    await writeLog({
      entityType: "addon",
      entityId: addon._id,
      action,
      byUserId: req.dashboardUserId,
      byRole: req.dashboardUserRole,
      meta,
    });
  } catch (_err) {
    // Activity logging must not block catalog writes.
  }
}

function normalizeAddonKind(value, { forceKind = null } = {}) {
  if (forceKind && value !== undefined && value !== null && String(value).trim() && String(value).trim() !== forceKind) {
    throw { status: 400, code: "INVALID", message: `kind must be ${forceKind}` };
  }
  const raw = forceKind || value || "item";
  const kind = String(raw || "").trim();
  if (!ADDON_KINDS.has(kind)) {
    throw { status: 400, code: "INVALID", message: "kind must be one of: plan, item" };
  }
  return kind;
}

function normalizeAddonCategory(value) {
  const category = String(value || "").trim();
  if (!category) {
    throw { status: 400, code: "INVALID", message: "category is required" };
  }
  if (!ADDON_CATEGORIES.has(category)) {
    throw { status: 400, code: "INVALID", message: "category must be one of: juice, snack, small_salad" };
  }
  return category;
}

function resolveAddonBillingMode({ kind, rawBillingMode }) {
  const billingMode = rawBillingMode
    ? normalizeOptionalString(rawBillingMode)
    : kind === "plan"
      ? "per_day"
      : "flat_once";

  if (!ADDON_BILLING_MODES.has(billingMode)) {
    throw {
      status: 400,
      code: "INVALID",
      message: "billingMode must be one of: flat_once, per_day, per_meal",
    };
  }

  const allowedModes = kind === "plan" ? PLAN_BILLING_MODES : ITEM_BILLING_MODES;
  if (!allowedModes.has(billingMode)) {
    throw {
      status: 400,
      code: "INVALID",
      message:
        kind === "plan"
          ? "kind=plan supports billingMode per_day or per_meal"
          : "kind=item supports billingMode flat_once only",
    };
  }

  return billingMode;
}

function buildAddonDerivedBillingFields(billingMode) {
  if (billingMode === "flat_once") {
    return { type: "one_time", pricingModel: "one_time", billingUnit: "item" };
  }
  if (billingMode === "per_day") {
    return { type: "subscription", pricingModel: "subscription", billingUnit: "day" };
  }
  return { type: "subscription", pricingModel: "subscription", billingUnit: "meal" };
}

function validateAddonPayloadOrThrow(payload, { forceKind = null, dashboardPlanCreate = false } = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw { status: 400, code: "INVALID", message: "Request body must be an object" };
  }

  if (dashboardPlanCreate) {
    if (!payload.name || typeof payload.name !== "object" || Array.isArray(payload.name)
      || typeof payload.name.ar !== "string" || typeof payload.name.en !== "string") {
      throw { status: 400, code: "INVALID", message: "name.ar and name.en are required non-empty strings" };
    }
    if (payload.isActive !== undefined && typeof payload.isActive !== "boolean") {
      throw { status: 400, code: "INVALID", message: "isActive must be a boolean" };
    }
    if (payload.maxPerDay !== undefined && typeof payload.maxPerDay !== "number") {
      throw { status: 400, code: "INVALID", message: "maxPerDay must be a number >= 0" };
    }
  }

  const kind = normalizeAddonKind(payload.kind, { forceKind });
  const category = normalizeAddonCategory(payload.category);
  const name = normalizeName(parseLocalizedFieldFromBody(payload, "name", { allowString: true }) ?? payload.name);
  if (dashboardPlanCreate && (!name.ar || !name.en)) {
    throw { status: 400, code: "INVALID", message: "name.ar and name.en are required non-empty strings" };
  }
  const description = normalizeLocalizedOptional(
    parseLocalizedFieldFromBody(payload, "description", { allowString: true }) ?? payload.description
  );
  const imageUrl = normalizeOptionalString(payload.imageUrl);

  const currency = payload.currency === undefined ? SYSTEM_CURRENCY : normalizeOptionalString(payload.currency).toUpperCase();
  if (!currency) {
    throw { status: 400, code: "INVALID", message: "currency must be a non-empty string" };
  }
  if (currency !== SYSTEM_CURRENCY) {
    throw { status: 400, code: "INVALID", message: `currency must be ${SYSTEM_CURRENCY}` };
  }

  let priceHalala = 0;
  if (payload.priceHalala !== undefined && payload.priceHalala !== null && String(payload.priceHalala).trim() !== "") {
    const val = Number(payload.priceHalala);
    if (!isNonNegativeInteger(val)) {
      throw { status: 400, code: "INVALID", message: "priceHalala must be an integer >= 0" };
    }
    priceHalala = val;
  } else if (kind === "item") {
    throw { status: 400, code: "INVALID", message: "priceHalala is required for one-time items" };
  }

  const isActive = parseBooleanField(payload.isActive, "isActive", { defaultValue: true });
  const sortOrder = payload.sortOrder === undefined ? 0 : normalizeSortOrder(payload.sortOrder, "sortOrder");
  const rawBillingMode = payload.billingMode === undefined || payload.billingMode === null
    ? ""
    : payload.billingMode;
  const billingMode = resolveAddonBillingMode({ kind, rawBillingMode });
  const derivedBillingFields = buildAddonDerivedBillingFields(billingMode);

  let menuProductId = null;
  if (payload.menuProductId && String(payload.menuProductId).trim() !== "") {
    validateObjectId(payload.menuProductId, "menuProductId");
    menuProductId = payload.menuProductId;
  }

  const menuProductIds = Array.isArray(payload.menuProductIds)
    ? payload.menuProductIds.map((id) => {
        validateObjectId(id, "menuProductIds");
        return id;
      })
    : [];

  if (kind === "plan") {
    if (menuProductIds.length === 0) {
      throw { status: 400, code: "INVALID", message: "menuProductIds must contain at least one product" };
    }
  }

  const menuCategoryKeys = [];

  let maxPerDay = 1;
  if (payload.maxPerDay !== undefined && payload.maxPerDay !== null) {
    const parsedMax = Number(payload.maxPerDay);
    if (!Number.isFinite(parsedMax) || parsedMax < 0) {
      throw { status: 400, code: "INVALID", message: "maxPerDay must be a number >= 0" };
    }
    maxPerDay = parsedMax;
  }

  return {
    name,
    description,
    imageUrl,
    priceHalala,
    price: priceHalala / 100,
    priceSar: priceHalala / 100,
    priceLabel: `${priceHalala / 100} SAR`,
    currency,
    kind,
    category,
    isActive,
    sortOrder,
    menuProductId,
    menuProductIds,
    menuCategoryKeys,
    maxPerDay,
    ...derivedBillingFields,
    billingMode,
  };
}

function resolveAdminAddonFilters(query = {}, { forceKind = null } = {}) {
  const filters = {};
  const kind = forceKind || query.kind;
  if (kind !== undefined && kind !== null && String(kind).trim() !== "") {
    filters.kind = normalizeAddonKind(kind, { forceKind });
  }
  if (query.category !== undefined && query.category !== null && String(query.category).trim() !== "") {
    filters.category = normalizeAddonCategory(query.category);
  }
  if (query.billingMode !== undefined && query.billingMode !== null && String(query.billingMode).trim() !== "") {
    const billingMode = normalizeOptionalString(query.billingMode);
    if (!ADDON_BILLING_MODES.has(billingMode)) {
      throw { status: 400, code: "INVALID", message: "billingMode must be one of: flat_once, per_day, per_meal" };
    }
    filters.billingMode = billingMode;
  }
  const status = query.status === undefined || query.status === null || String(query.status).trim() === ""
    ? "all"
    : String(query.status).trim().toLowerCase();
  if (!["active", "inactive", "archived", "all"].includes(status)) {
    throw { status: 400, code: "INVALID", message: "status must be one of: active, inactive, archived, all" };
  }
  if (status === "active") {
    filters.isActive = true;
    filters.isArchived = { $ne: true };
  } else if (status === "inactive") {
    filters.isActive = false;
    filters.isArchived = { $ne: true };
  } else if (status === "archived") {
    filters.isArchived = true;
  } else if (query.isActive !== undefined && query.isActive !== null && String(query.isActive).trim() !== "") {
    filters.isActive = parseBooleanField(query.isActive, "isActive");
  }
  if (query.q !== undefined && query.q !== null && String(query.q).trim() !== "") {
    const escaped = String(query.q).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped, "i");
    filters.$or = [{ "name.ar": regex }, { "name.en": regex }];
  }
  return filters;
}

function resolvePublicAddonFilters(query = {}) {
  const filters = { isActive: true, isArchived: { $ne: true } };

  if (query.type !== undefined && query.type !== null && String(query.type).trim() !== "") {
    const type = String(query.type).trim();
    if (!["subscription", "one_time"].includes(type)) {
      throw { status: 400, code: "INVALID", message: "type must be one of: subscription, one_time" };
    }
    filters.$or = type === "subscription"
      ? [
        { type: "subscription" },
        { kind: "plan" },
        { billingMode: { $in: ["per_day", "per_meal"] } },
        { pricingModel: { $in: ["subscription", "daily_recurring", "meal_recurring"] } },
      ]
      : [
        { type: "one_time" },
        { kind: "item" },
        { billingMode: "flat_once" },
        { pricingModel: "one_time" },
      ];
  }

  if (query.kind !== undefined && query.kind !== null && String(query.kind).trim() !== "") {
    const kind = normalizeAddonKind(query.kind);
    const queryType = query.type !== undefined && query.type !== null ? String(query.type).trim() : "";
    const expectedKind = queryType === "subscription" ? "plan" : queryType === "one_time" ? "item" : "";
    if (expectedKind && expectedKind !== kind) {
      throw { status: 400, code: "INVALID", message: "type and kind filters are incompatible" };
    }
    filters.$or = kind === "plan"
      ? [
        { kind: "plan" },
        { type: "subscription" },
        { billingMode: { $in: ["per_day", "per_meal"] } },
        { pricingModel: { $in: ["subscription", "daily_recurring", "meal_recurring"] } },
      ]
      : [
        { kind: "item" },
        { type: "one_time" },
        { billingMode: "flat_once" },
        { pricingModel: "one_time" },
      ];
  }

  if (query.category !== undefined && query.category !== null && String(query.category).trim() !== "") {
    filters.category = normalizeAddonCategory(query.category);
  }

  return filters;
}

async function listAddons(req, res) {
  const lang = getRequestLang(req);
  let filters;
  try {
    filters = resolvePublicAddonFilters(req.query || {});
  } catch (err) {
    return errorResponse(res, err.status || 400, err.code || "INVALID", err.message || "Invalid addon filters");
  }

  const basePlanId = req.query.basePlanId || req.query.planId;
  const AddonPlanPrice = require("../models/AddonPlanPrice");
  let priceMap = new Map();
  if (basePlanId) {
    try {
      validateObjectId(basePlanId, "basePlanId");
      const prices = await AddonPlanPrice.find({ basePlanId, isActive: true }).lean();
      for (const p of prices) {
        priceMap.set(String(p.addonPlanId), p.priceHalala);
      }
    } catch (err) {
      // ignore invalid basePlanId parameter in listing
    }
  }

  const rows = await Addon.find(filters)
    .populate("menuProductId")
    .sort({ sortOrder: 1, createdAt: -1 })
    .lean();
    
  const mapped = rows.map((row) => {
    const data = { ...row };
    if (row.menuProductId && typeof row.menuProductId === "object") {
      data.priceHalala = row.menuProductId.priceHalala || row.priceHalala;
      data.price = data.priceHalala / 100;
      data.priceSar = data.price;
      data.priceLabel = `${data.priceSar} SAR`;
      data.menuProductId = String(row.menuProductId._id);
    }

    if (row.kind === "plan" && basePlanId) {
      const matrixPrice = priceMap.get(String(row._id));
      if (matrixPrice !== undefined) {
        data.priceHalala = matrixPrice;
        data.price = matrixPrice / 100;
        data.priceSar = matrixPrice / 100;
        data.priceLabel = `${matrixPrice / 100} SAR`;
      } else {
        data.isAvailable = false;
      }
    }
    
    const entry = resolveAddonCatalogEntry(data, lang);
    if (data.isAvailable === false) {
      entry.isAvailable = false;
    }
    return entry;
  });
  
  return res.status(200).json({ status: true, data: mapped });
}

async function buildFullyPopulatedAddonDetail(addonId, { includeInternal = false, session = null } = {}) {
  const Addon = require("../models/Addon");
  const MenuProduct = require("../models/MenuProduct");
  const AddonPlanPrice = require("../models/AddonPlanPrice");
  const Plan = require("../models/Plan");

  const query = { _id: addonId };
  let rowQuery = Addon.findOne(query);
  if (session) rowQuery = rowQuery.session(session);
  const row = await rowQuery.lean();
  if (!row) return null;

  const {
    priceHalala, priceSar, priceLabel, billingMode, billingUnit, price, menuProductId,
    ...cleanRow
  } = row;

  const data = { ...cleanRow };
  data.id = String(row._id);
  data.menuProductIds = (row.menuProductIds || []).map(String);
  data.menuCategoryKeys = [];
  data.menuProductsCount = data.menuProductIds.length;

  if (row.kind === "plan") {
    data.legacyCompatibility = {
      priceHalala, priceSar, priceLabel, billingMode, billingUnit, price, menuProductId,
    };

    data.menuCategories = [];

    // 2. Fetch menuProducts for menuProductIds
    let prodsQuery = MenuProduct.find({ _id: { $in: data.menuProductIds } }).populate("categoryId");
    if (session) prodsQuery = prodsQuery.session(session);
    const prods = await prodsQuery.lean();
    const productsById = new Map(prods.map((product) => [String(product._id), product]));

    // Preserve the configured add-on product order and only count products that
    // still resolve. Do not apply customer-channel filters to admin linkage data.
    data.menuProducts = data.menuProductIds
      .map((productId) => productsById.get(String(productId)))
      .filter(Boolean)
      .map(toDashboardMenuProductPickerDTO);

    // 3. Resolve union of products
    data.resolvedMenuProductIds = data.menuProducts.map((product) => product.id);
    data.resolvedMenuProductsCount = data.resolvedMenuProductIds.length;

    // 4. Fetch planPrices
    const matchQuery = includeInternal === true ? {} : Plan.getSellableQuery();
    let pricesQuery = AddonPlanPrice.find({ addonPlanId: row._id }).populate({ path: "basePlanId", match: matchQuery });
    if (session) pricesQuery = pricesQuery.session(session);
    const prices = await pricesQuery.lean();
    
    const validPrices = prices.filter(p => p.basePlanId != null);
    data.planPrices = validPrices.map((p) => {
      const basePlan = p.basePlanId || {};
      const daysCount = basePlan.daysCount || 0;
      let mealsCount = daysCount * 2;
      let basePlanPriceHalala = 0;

      if (basePlan.gramsOptions && basePlan.gramsOptions.length > 0) {
        const gramsOpt = basePlan.gramsOptions.find((g) => g.grams === 100) || basePlan.gramsOptions[0];
        if (gramsOpt && gramsOpt.mealsOptions && gramsOpt.mealsOptions.length > 0) {
          const mealOpt = gramsOpt.mealsOptions.find((m) => m.mealsPerDay === 2) || gramsOpt.mealsOptions[0];
          if (mealOpt) {
            mealsCount = daysCount * mealOpt.mealsPerDay;
            basePlanPriceHalala = mealOpt.priceHalala;
          }
        }
      }

      return {
        id: String(p._id),
        _id: p._id,
        addonPlanId: p.addonPlanId || row._id,
        basePlanId: basePlan._id || p.basePlanId,
        basePlanName: basePlan.name || { ar: "", en: "" },
        daysCount,
        mealsCount,
        basePlanPriceHalala,
        priceHalala: p.priceHalala,
        priceSar: p.priceHalala / 100,
        priceLabel: `${p.priceHalala / 100} SAR`,
        currency: p.currency || SYSTEM_CURRENCY,
        isActive: p.isActive !== false,
      };
    });

    data.planPricesCount = data.planPrices.length;
    data.pricingMode = "base_plan_matrix";
  } else {
    data.priceHalala = priceHalala;
    data.priceSar = priceSar;
    data.priceLabel = priceLabel;
    data.billingMode = billingMode;
    data.billingUnit = billingUnit;
    data.price = price;
    data.menuProductId = menuProductId;
    data.menuProducts = [];
    data.menuCategories = [];
    data.resolvedMenuProductIds = [];
    data.resolvedMenuProductsCount = 0;
    data.planPrices = [];
    data.planPricesCount = 0;
  }
  return data;
}

function toDashboardMenuProductPickerDTO(p) {
  const populatedCategory = p.categoryId && typeof p.categoryId === "object" ? p.categoryId : null;
  return {
    id: String(p._id || p.id),
    key: p.key || "",
    name: p.name || { ar: "", en: "" },
    category: populatedCategory ? populatedCategory.key : (p.category || ""),
    categoryName: populatedCategory && populatedCategory.name
      ? populatedCategory.name
      : (p.categoryName || { ar: "", en: "" }),
    image: p.imageUrl || p.image || "",
    isActive: p.isActive !== false,
    isVisible: p.isVisible !== false,
    isAvailable: p.isAvailable !== false,
  };
}

function toDashboardPlanPriceLeanDTO(p) {
  return {
    basePlanId: String(p.basePlanId || ""),
    basePlanName: p.basePlanName || { ar: "", en: "" },
    daysCount: p.daysCount || 0,
    mealsCount: p.mealsCount || 0,
    priceHalala: p.priceHalala || 0,
    priceSar: p.priceSar || 0,
    priceLabel: p.priceLabel || "",
    isActive: p.isActive !== false
  };
}

function toDashboardAddonPlanLeanDTO(plan) {
  return {
    id: String(plan._id || plan.id),
    name: plan.name || { ar: "", en: "" },
    category: plan.category || "",
    kind: plan.kind || "plan",
    type: plan.type || "subscription",
    maxPerDay: plan.maxPerDay ?? 1,
    isActive: plan.isActive !== false,
    isArchived: plan.isArchived === true,
    archivedAt: plan.archivedAt || null,
    menuProductIds: (plan.menuProductIds || []).map(String),
    menuCategoryKeys: [],
    menuCategories: [],
    resolvedMenuProductIds: (plan.resolvedMenuProductIds || []).map(String),
    resolvedMenuProductsCount: Number(plan.resolvedMenuProductsCount || 0),
    menuProducts: (plan.menuProducts || []).map(toDashboardMenuProductPickerDTO),
    planPrices: (plan.planPrices || []).map(toDashboardPlanPriceLeanDTO)
  };
}

async function listAddonsAdmin(req, res, options = {}) {
  try {
    const filters = resolveAdminAddonFilters(req.query || {}, options);

    const hasQueryFilter = req.query && (
      req.query.kind !== undefined ||
      req.query.category !== undefined ||
      req.query.billingMode !== undefined ||
      req.query.isActive !== undefined ||
      req.query.q !== undefined
    );

    if (!options.dashboardPlanList && (options.forceKind || hasQueryFilter)) {
      const rows = await Addon.find(filters).sort({ sortOrder: 1, createdAt: -1 }).lean();

      const AddonPlanPrice = require("../models/AddonPlanPrice");
      const Plan = require("../models/Plan");
      const { includeInternal } = req.query || {};
      const matchQuery = includeInternal === "true" ? {} : Plan.getSellableQuery();
      const validBasePlans = await Plan.find(matchQuery).select("_id").lean();
      const validBasePlanIds = validBasePlans.map(p => String(p._id));

      const addonPlanPrices = await AddonPlanPrice.find({ isActive: true }).lean();
      const validAddonPlanPrices = addonPlanPrices.filter(p => validBasePlanIds.includes(String(p.basePlanId)));

      const mapped = rows.map((row) => {
        const menuProductIds = row.menuProductIds || [];
        const menuProductsCount = menuProductIds.length;
        
        let planPricesCount = 0;
        if (row.kind === "plan") {
          planPricesCount = validAddonPlanPrices.filter(p => String(p.addonPlanId) === String(row._id)).length;
        }

        const {
          priceHalala, priceSar, priceLabel, billingMode, billingUnit, price, menuProductId,
          ...cleanRow
        } = row;

        if (row.kind === "plan") {
          cleanRow.legacyCompatibility = {
            priceHalala, priceSar, priceLabel, billingMode, billingUnit, price, menuProductId,
          };
        } else {
          cleanRow.priceHalala = priceHalala;
          cleanRow.priceSar = priceSar;
          cleanRow.priceLabel = priceLabel;
          cleanRow.billingMode = billingMode;
          cleanRow.billingUnit = billingUnit;
          cleanRow.price = price;
          cleanRow.menuProductId = menuProductId;
        }

        return {
          id: String(row._id),
          ...cleanRow,
          menuProductIds,
          menuCategoryKeys: [],
          menuProductsCount,
          planPricesCount,
          pricingMode: row.kind === "plan" ? "base_plan_matrix" : undefined,
        };
      });

      return res.status(200).json({ status: true, data: mapped, meta: { filters, totalCount: rows.length } });
    }

    const allAddons = await Addon.find({
      ...filters,
      kind: "plan",
    }).sort({ sortOrder: 1, createdAt: -1 }).lean();

    const viewFull = req.query && req.query.view === "full";

    // Apply dashboard visibility filter to items: exclude inactive and test/contract records.
    // Plans are always shown (they are canonical by category) and not filtered here.
    const dashItemFilter = buildDashboardItemsExcludeFilter();
    const testNameRe = DASHBOARD_TEST_NAME_PATTERN;
    const itemsRaw = allAddons.filter(a =>
      a.kind === "item" &&
      a.isActive !== false &&
      !testNameRe.test(a.name && a.name.en ? a.name.en : "") &&
      !testNameRe.test(a.name && a.name.ar ? a.name.ar : "")
    );
    void dashItemFilter; // used for documentation; inline filter applied above
    
    const plansRaw = allAddons;

    const plans = [];
    for (const planRow of plansRaw) {
      let populated = await buildFullyPopulatedAddonDetail(planRow._id, {
        includeInternal: req.query && req.query.includeInternal === "true",
      });
      if (populated) {
        plans.push(populated);
      }
    }

    const items = viewFull ? itemsRaw.map((row) => {
      const {
        priceHalala, priceSar, priceLabel, billingMode, billingUnit, price, menuProductId,
        ...cleanRow
      } = row;

      return {
        id: String(row._id),
        ...cleanRow,
        priceHalala,
        priceSar,
        priceLabel,
        billingMode,
        billingUnit,
        price,
        menuProductId,
        menuProductIds: row.menuProductIds || [],
        menuProductsCount: (row.menuProductIds || []).length,
      };
    }) : undefined;

    const matrixRowsCount = plans.reduce((sum, p) => sum + (p.planPrices ? p.planPrices.length : 0), 0);

    const responsePayload = {
      status: true,
      data: {
        plans: viewFull ? plans : plans.map(toDashboardAddonPlanLeanDTO),
        meta: {
          addonPlanCategories: viewFull ? ADDON_PLAN_CATEGORIES_META : ADDON_PLAN_CATEGORIES_META.map(c => ({ key: c.key, label: c.label })),
        },
        summary: {
          plansCount: plans.length,
          matrixRowsCount,
          currency: "SAR",
        },
      },
    };

    if (viewFull) {
      responsePayload.data.items = items;
      responsePayload.data.summary.itemsCount = items.length;
      responsePayload.data.summary.totalItems = items.length;
      responsePayload.data.summary.totalPlans = plans.length;
    }

    return res.status(200).json(responsePayload);
  } catch (err) {
    if (err && err.status) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function listDashboardAddonPlans(req, res) {
  return listAddonsAdmin(req, res, { forceKind: "plan", dashboardPlanList: true });
}

async function getAddonAdmin(req, res, options = {}) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  try {
    const { includeInternal } = req.query || {};
    const data = await buildFullyPopulatedAddonDetail(id, {
      includeInternal: includeInternal === "true",
    });
    if (!data) {
      return errorResponse(res, 404, "NOT_FOUND", "Addon not found");
    }
    if (options.forceKind && data.kind !== options.forceKind) {
      return errorResponse(res, 404, "NOT_FOUND", "Addon not found");
    }
    return res.status(200).json({ status: true, data });
  } catch (err) {
    if (err && err.status) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function createAddon(req, res, options = {}) {
  const session = await startSafeSession().catch(() => null);
  if (session) session.startTransaction();

  try {
    const payload = validateAddonPayloadOrThrow(req.body || {}, options);
    
    // Verify basePlanIds from planPrices if any
    const planPricesInput = [];
    if (payload.kind === "plan" && req.body.planPrices !== undefined) {
      if (!Array.isArray(req.body.planPrices)) {
        throw { status: 400, code: "INVALID", message: "planPrices must be an array" };
      }
      const Plan = require("../models/Plan");
      for (let i = 0; i < req.body.planPrices.length; i++) {
        const p = req.body.planPrices[i];
        if (!p || typeof p !== "object") {
          throw { status: 400, code: "INVALID", message: "Each item in planPrices must be an object" };
        }
        validateObjectId(p.basePlanId, `planPrices[${i}].basePlanId`);
        const basePlanId = p.basePlanId;
        if (options.dashboardPlanCreate && typeof p.priceHalala !== "number") {
          throw { status: 400, code: "INVALID", message: `planPrices[${i}].priceHalala must be a number >= 0` };
        }
        if (options.dashboardPlanCreate && p.isActive !== undefined && typeof p.isActive !== "boolean") {
          throw { status: 400, code: "INVALID", message: `planPrices[${i}].isActive must be a boolean` };
        }
        const rowPrice = Number(p.priceHalala);
        if (!isNonNegativeInteger(rowPrice)) {
          throw { status: 400, code: "INVALID", message: `planPrices[${i}].priceHalala must be an integer >= 0` };
        }
        const rowIsActive = p.isActive !== undefined ? !!p.isActive : true;
        planPricesInput.push({ basePlanId, priceHalala: rowPrice, isActive: rowIsActive });
      }

      if (planPricesInput.length > 0) {
        const basePlanIds = planPricesInput.map(p => p.basePlanId);
        const existingPlansCount = await Plan.countDocuments({ _id: { $in: basePlanIds } });
        if (existingPlansCount !== new Set(basePlanIds.map(String)).size) {
          throw { status: 400, code: "INVALID", message: "One or more basePlanIds in planPrices do not exist" };
        }
        const basePlanIdStrings = planPricesInput.map(p => String(p.basePlanId));
        if (new Set(basePlanIdStrings).size !== basePlanIdStrings.length) {
          throw { status: 400, code: "INVALID", message: "Duplicate basePlanId in planPrices is not allowed" };
        }
      }
    }
    if (options.dashboardPlanCreate && planPricesInput.length === 0) {
      throw { status: 400, code: "INVALID", message: "planPrices must contain at least one item" };
    }

    if (payload.kind === "plan") {
      const uniqueProductIds = [...new Set(payload.menuProductIds.map(String))];
      if (uniqueProductIds.length !== payload.menuProductIds.length) {
        throw { status: 400, code: "INVALID", message: "Duplicate menuProductIds are not allowed" };
      }
      const productCount = await MenuProduct.countDocuments({ _id: { $in: payload.menuProductIds } });
      if (productCount !== payload.menuProductIds.length) {
        throw { status: 400, code: "INVALID", message: "One or more menuProductIds do not exist" };
      }
    }

    const imageState = await resolveManagedImageFromRequest({
      body: req.body,
      file: req.file,
      folder: ADDON_IMAGE_FOLDER,
      allowDirectImageUrl: true,
    });

    let addonDoc;
    if (session) {
      const docs = await Addon.create([{
        ...payload,
        imageUrl: imageState.imageUrl,
      }], { session });
      addonDoc = docs[0];
    } else {
      addonDoc = await Addon.create({
        ...payload,
        imageUrl: imageState.imageUrl,
      });
    }

    if (payload.kind === "plan" && planPricesInput.length > 0) {
      const AddonPlanPrice = require("../models/AddonPlanPrice");
      for (const p of planPricesInput) {
        if (p.isActive) {
          const existingActive = await AddonPlanPrice.findOne({
            addonPlanId: addonDoc._id,
            basePlanId: p.basePlanId,
            isActive: true,
          }).session(session).lean();
          if (existingActive) {
            throw { status: 400, code: "DUPLICATE_ACTIVE_PRICE", message: "An active price matrix row already exists for this combination." };
          }
        }
        await AddonPlanPrice.create([{
          addonPlanId: addonDoc._id,
          basePlanId: p.basePlanId,
          priceHalala: p.priceHalala,
          currency: payload.currency || SYSTEM_CURRENCY,
          isActive: p.isActive,
        }], { session });
      }
    }

    await writeAddonActivityLogSafely(req, addonDoc, "addon_created_by_admin", {
      kind: addonDoc.kind,
      category: addonDoc.category,
      billingMode: addonDoc.billingMode,
    });

    if (session) {
      await session.commitTransaction();
      session.endSession();
    }

    const data = await buildFullyPopulatedAddonDetail(addonDoc._id);
    return res.status(201).json({
      status: true,
      data: options.dashboardPlanCreate ? toDashboardAddonPlanLeanDTO(data) : data,
    });

  } catch (err) {
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }
    if (err && err.status) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function updateAddon(req, res, options = {}) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const session = await startSafeSession().catch(() => null);
  if (session) session.startTransaction();

  try {
    const query = { _id: id };
    if (options.forceKind) query.kind = options.forceKind;
    
    let existingQuery = Addon.findOne(query);
    if (session) existingQuery = existingQuery.session(session);
    const existing = await existingQuery;

    if (!existing) {
      if (session) {
        await session.abortTransaction();
        session.endSession();
      }
      return errorResponse(res, 404, "NOT_FOUND", "Addon not found");
    }

    if (!req.body.kind && existing.kind) {
      req.body.kind = existing.kind;
    }

    const payload = validateAddonPayloadOrThrow(req.body || {}, options);
    
    // Verify basePlanIds from planPrices if any
    const planPricesInput = [];
    if (payload.kind === "plan" && req.body.planPrices !== undefined) {
      if (!Array.isArray(req.body.planPrices)) {
        throw { status: 400, code: "INVALID", message: "planPrices must be an array" };
      }
      const Plan = require("../models/Plan");
      for (let i = 0; i < req.body.planPrices.length; i++) {
        const p = req.body.planPrices[i];
        if (!p || typeof p !== "object") {
          throw { status: 400, code: "INVALID", message: "Each item in planPrices must be an object" };
        }
        validateObjectId(p.basePlanId, `planPrices[${i}].basePlanId`);
        const basePlanId = p.basePlanId;
        const rowPrice = Number(p.priceHalala);
        if (!isNonNegativeInteger(rowPrice)) {
          throw { status: 400, code: "INVALID", message: `planPrices[${i}].priceHalala must be an integer >= 0` };
        }
        const rowIsActive = p.isActive !== undefined ? !!p.isActive : true;
        planPricesInput.push({ basePlanId, priceHalala: rowPrice, isActive: rowIsActive });
      }

      if (planPricesInput.length > 0) {
        const basePlanIds = planPricesInput.map(p => p.basePlanId);
        const existingPlansCount = await Plan.countDocuments({ _id: { $in: basePlanIds } });
        if (existingPlansCount !== new Set(basePlanIds.map(String)).size) {
          throw { status: 400, code: "INVALID", message: "One or more basePlanIds in planPrices do not exist" };
        }
        const basePlanIdStrings = planPricesInput.map(p => String(p.basePlanId));
        if (new Set(basePlanIdStrings).size !== basePlanIdStrings.length) {
          throw { status: 400, code: "INVALID", message: "Duplicate basePlanId in planPrices is not allowed" };
        }
      }
    }

    if (payload.kind === "plan") {
      const uniqueProductIds = [...new Set(payload.menuProductIds.map(String))];
      if (uniqueProductIds.length !== payload.menuProductIds.length) {
        throw { status: 400, code: "INVALID", message: "Duplicate menuProductIds are not allowed" };
      }
      const productCount = await MenuProduct.countDocuments({ _id: { $in: payload.menuProductIds } });
      if (productCount !== payload.menuProductIds.length) {
        throw { status: 400, code: "INVALID", message: "One or more menuProductIds do not exist" };
      }
    }

    const imageState = await resolveManagedImageFromRequest({
      body: req.body,
      file: req.file,
      folder: ADDON_IMAGE_FOLDER,
      currentImageUrl: existing.imageUrl,
      allowDirectImageUrl: true,
    });

    existing.set({
      ...payload,
      imageUrl: imageState.imageUrl,
    });
    await existing.save({ session });

    if (payload.kind === "plan" && req.body.planPrices !== undefined) {
      const AddonPlanPrice = require("../models/AddonPlanPrice");
      
      // Delete existing plan prices
      await AddonPlanPrice.deleteMany({ addonPlanId: existing._id }).session(session);

      // Create new plan prices
      for (const p of planPricesInput) {
        if (p.isActive) {
          const existingActive = await AddonPlanPrice.findOne({
            addonPlanId: existing._id,
            basePlanId: p.basePlanId,
            isActive: true,
          }).session(session).lean();
          if (existingActive) {
            throw { status: 400, code: "DUPLICATE_ACTIVE_PRICE", message: "An active price matrix row already exists for this combination." };
          }
        }
        await AddonPlanPrice.create([{
          addonPlanId: existing._id,
          basePlanId: p.basePlanId,
          priceHalala: p.priceHalala,
          currency: payload.currency || SYSTEM_CURRENCY,
          isActive: p.isActive,
        }], { session });
      }
    }

    await writeAddonActivityLogSafely(req, existing, "addon_updated_by_admin", {
      kind: existing.kind,
      category: existing.category,
      billingMode: existing.billingMode,
    });

    if (session) {
      await session.commitTransaction();
      session.endSession();
    }

    const data = await buildFullyPopulatedAddonDetail(existing._id);
    const viewFull = req.query && req.query.view === "full";
    return res.status(200).json({ status: true, data: viewFull || data.kind !== "plan" ? data : toDashboardAddonPlanLeanDTO(data) });
  } catch (err) {
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }
    if (err && err.status) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function patchAddon(req, res, options = {}) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
    const query = { _id: id };
    if (options.forceKind) query.kind = options.forceKind;
    const existing = await Addon.findOne(query);
    if (!existing) return errorResponse(res, 404, "NOT_FOUND", "Addon not found");

    const payload = {};
    if (req.body.menuProductId !== undefined) {
      let menuProductId = null;
      if (req.body.menuProductId && String(req.body.menuProductId).trim() !== "") {
        validateObjectId(req.body.menuProductId, "menuProductId");
        menuProductId = req.body.menuProductId;
      }
      payload.menuProductId = menuProductId;
    }

    if (req.body.menuProductIds !== undefined) {
      if (!Array.isArray(req.body.menuProductIds)) {
        return errorResponse(res, 400, "INVALID", "menuProductIds must be an array");
      }
      payload.menuProductIds = req.body.menuProductIds.map((id) => {
        validateObjectId(id, "menuProductIds");
        return id;
      });
    }

    if (existing.kind === "plan") {
      payload.menuCategoryKeys = [];
      const finalProductIds = payload.menuProductIds !== undefined ? payload.menuProductIds : existing.menuProductIds;
      if (!finalProductIds || finalProductIds.length === 0) {
        return errorResponse(res, 400, "INVALID", "menuProductIds must contain at least one product");
      }

      if (payload.menuProductIds && payload.menuProductIds.length > 0) {
        const uniqueProductIds = [...new Set(payload.menuProductIds.map(String))];
        if (uniqueProductIds.length !== payload.menuProductIds.length) {
          return errorResponse(res, 400, "INVALID", "Duplicate menuProductIds are not allowed");
        }
        const productCount = await MenuProduct.countDocuments({ _id: { $in: payload.menuProductIds } });
        if (productCount !== payload.menuProductIds.length) {
          return errorResponse(res, 400, "INVALID", "One or more menuProductIds do not exist");
        }
      }
    }

    if (req.body.maxPerDay !== undefined && req.body.maxPerDay !== null) {
      const parsedMax = Number(req.body.maxPerDay);
      if (!Number.isInteger(parsedMax) || parsedMax < 1) {
        return errorResponse(res, 400, "INVALID", "maxPerDay must be an integer >= 1");
      }
      payload.maxPerDay = parsedMax;
    }
    
    // Support basic fields in patch
    if (req.body.isActive !== undefined) payload.isActive = parseBooleanField(req.body.isActive);
    if (req.body.sortOrder !== undefined) payload.sortOrder = normalizeSortOrder(req.body.sortOrder);
    if (req.body.priceHalala !== undefined) {
      payload.priceHalala = Number(req.body.priceHalala);
      payload.price = payload.priceHalala / 100;
      payload.priceSar = payload.price;
      payload.priceLabel = `${payload.priceSar} SAR`;
    }

    existing.set(payload);
    await existing.save();

    await writeAddonActivityLogSafely(req, existing, "addon_patched_by_admin", { patchedFields: Object.keys(payload) });
    return res.status(200).json({ status: true, data: { id: existing.id } });
  } catch (err) {
    if (err && err.status) return errorResponse(res, err.status, err.code, err.message);
    throw err;
  }
}

async function deleteAddon(req, res, options = {}) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const query = { _id: id };
  if (options.forceKind) query.kind = options.forceKind;
  const archivedAt = new Date();
  const row = await Addon.findOneAndUpdate(
    query,
    { $set: { isActive: false, isArchived: true, archivedAt } },
    { new: true }
  );
  if (!row) {
    return errorResponse(res, 404, "NOT_FOUND", "Addon not found");
  }
  await writeAddonActivityLogSafely(req, row, "addon_soft_deleted_by_admin", {
    kind: row.kind,
    category: row.category,
  });
  return res.status(200).json({
    status: true,
    data: options.dashboardPlanDelete
      ? { id: row.id, archived: true, isActive: false, isArchived: true, archivedAt: row.archivedAt }
      : { id: row.id, isActive: row.isActive, isArchived: true, archivedAt: row.archivedAt },
  });
}

async function toggleAddonActive(req, res, options = {}) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const query = { _id: id };
  if (options.forceKind) query.kind = options.forceKind;
  const row = await Addon.findOne(query).select("_id isActive kind category");
  if (!row) {
    return errorResponse(res, 404, "NOT_FOUND", "Addon not found");
  }
  const nextIsActive = !row.isActive;
  await Addon.updateOne({ _id: row._id }, { $set: { isActive: nextIsActive } });
  row.isActive = nextIsActive;

  await writeAddonActivityLogSafely(req, row, "addon_toggled_by_admin", {
    kind: row.kind,
    category: row.category,
    isActive: row.isActive,
  });
  return res.status(200).json({ status: true, data: { id: row.id, isActive: row.isActive } });
}

async function updateAddonSortOrder(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  try {
    const sortOrder = normalizeSortOrder(req.body && req.body.sortOrder, "sortOrder");
    const row = await Addon.findByIdAndUpdate(id, { sortOrder }, { new: true, runValidators: true });
    if (!row) {
      return errorResponse(res, 404, "NOT_FOUND", "Addon not found");
    }
    return res.status(200).json({ status: true, data: { id: row.id, sortOrder: row.sortOrder } });
  } catch (err) {
    if (err && err.status) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function cloneAddon(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const row = await Addon.findById(id).lean();
  if (!row) {
    return errorResponse(res, 404, "NOT_FOUND", "Addon not found");
  }

  const payload = validateAddonPayloadOrThrow({
    name: row.name,
    description: row.description,
    imageUrl: row.imageUrl,
    priceHalala: Number.isInteger(row.priceHalala) ? row.priceHalala : Math.max(0, Math.round(Number(row.price || 0) * 100)),
    currency: row.currency,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    kind: row.kind,
    category: row.category,
    billingMode: row.billingMode,
  });

  const cloned = await Addon.create(payload);
  await writeAddonActivityLogSafely(req, cloned, "addon_cloned_by_admin", {
    sourceAddonId: String(row._id),
    kind: cloned.kind,
    category: cloned.category,
  });
  return res.status(201).json({ status: true, data: { id: cloned.id } });
}

const forcePlanKind = { forceKind: "plan" };
const dashboardPlanCreateOptions = { forceKind: "plan", dashboardPlanCreate: true };
const dashboardPlanDeleteOptions = { forceKind: "plan", dashboardPlanDelete: true };
const forceItemKind = { forceKind: "item" };

async function listAddonPlansAdmin(req, res) {
  return listAddonsAdmin(req, res, forcePlanKind);
}

async function getAddonPlanAdmin(req, res) {
  return getAddonAdmin(req, res, forcePlanKind);
}

async function createAddonPlan(req, res) {
  return createAddon(req, res, forcePlanKind);
}

async function createDashboardAddonPlan(req, res) {
  return createAddon(req, res, dashboardPlanCreateOptions);
}

async function deleteDashboardAddonPlan(req, res) {
  return deleteAddon(req, res, dashboardPlanDeleteOptions);
}

async function updateAddonPlan(req, res) {
  return updateAddon(req, res, forcePlanKind);
}

async function toggleAddonPlanActive(req, res) {
  return toggleAddonActive(req, res, forcePlanKind);
}

async function deleteAddonPlan(req, res) {
  return deleteAddon(req, res, forcePlanKind);
}

async function listAddonItemsAdmin(req, res) {
  return listAddonsAdmin(req, res, forceItemKind);
}

async function getAddonItemAdmin(req, res) {
  return getAddonAdmin(req, res, forceItemKind);
}

async function createAddonItem(req, res) {
  return createAddon(req, res, forceItemKind);
}

async function updateAddonItem(req, res) {
  return updateAddon(req, res, forceItemKind);
}

async function toggleAddonItemActive(req, res) {
  return toggleAddonActive(req, res, forceItemKind);
}

async function deleteAddonItem(req, res) {
  return deleteAddon(req, res, forceItemKind);
}

/**
 * GET /api/subscriptions/addons/options?planId=:planId
 *
 * Customer-facing endpoint that returns active add-on subscription plans
 * with backend-resolved flat matrix prices for the selected base plan.
 * Flutter uses this to display add-on options and prices before calling quote.
 */
async function getAddonSubscriptionOptions(req, res) {
  const lang = getRequestLang(req);
  const planId = req.query.planId;

  if (!planId || !String(planId).trim()) {
    return errorResponse(res, 400, "VALIDATION_ERROR", "planId query parameter is required");
  }
  try {
    validateObjectId(planId, "planId");
  } catch (err) {
    return errorResponse(res, 400, "VALIDATION_ERROR", "planId must be a valid ObjectId");
  }

  const Plan = require("../models/Plan");
  const plan = await Plan.findOne({ _id: planId, isActive: true }).lean();
  if (!plan) {
    return errorResponse(res, 404, "NOT_FOUND", "Base plan not found or inactive");
  }

  const AddonPlanPrice = require("../models/AddonPlanPrice");
  const matrixRows = await AddonPlanPrice.find({ basePlanId: planId, isActive: true }).lean();

  if (!matrixRows.length) {
    return res.status(200).json({
      status: true,
      data: { planId: String(plan._id), addons: [] },
    });
  }

  const priceByAddonId = new Map();
  const addonIds = [];
  for (const row of matrixRows) {
    const key = String(row.addonPlanId);
    priceByAddonId.set(key, row.priceHalala);
    addonIds.push(row.addonPlanId);
  }

  const addonDocs = await Addon.find({
    _id: { $in: addonIds },
    kind: "plan",
    isActive: true,
  }).lean();

  // Collect all menuProductIds across all addons for a single batch query
  const allMenuProductIds = [];
  for (const doc of addonDocs) {
    if (Array.isArray(doc.menuProductIds)) {
      for (const pid of doc.menuProductIds) allMenuProductIds.push(pid);
    }
  }

  const menuProductDocs = allMenuProductIds.length
    ? await MenuProduct.find({ _id: { $in: allMenuProductIds } }).populate("categoryId").lean()
    : [];
  const menuProductById = new Map(
    menuProductDocs.map((p) => [String(p._id), p])
  );

  const addons = addonDocs.map((doc) => {
    const matrixPrice = priceByAddonId.get(String(doc._id));
    const priceSar = matrixPrice / 100;
    const productIds = Array.isArray(doc.menuProductIds) ? doc.menuProductIds : [];
    const menuProducts = productIds
      .map((pid) => menuProductById.get(String(pid)))
      .filter(Boolean)
      .map((p) => ({
        id: String(p._id),
        _id: p._id,
        key: p.key,
        name: p.name,
        image: p.imageUrl || "",
        category: p.categoryId ? p.categoryId.key : "",
        isActive: p.isActive !== false,
      }));

    return {
      id: String(doc._id),
      addonPlanId: String(doc._id),
      name: doc.name,
      category: doc.category || "",
      maxPerDay: doc.maxPerDay || 1,
      pricingMode: "base_plan_matrix",
      priceHalala: matrixPrice,
      priceSar,
      priceLabel: `${priceSar} SAR`,
      currency: doc.currency || SYSTEM_CURRENCY,
      isAvailable: true,
      menuProductIds: productIds.map(String),
      menuProductsCount: menuProducts.length,
      menuProducts,
    };
  });

  return res.status(200).json({
    status: true,
    data: { planId: String(plan._id), addons },
  });
}

module.exports = {
  getAddonSubscriptionOptions,
  listAddons,
  listAddonsAdmin,
  listDashboardAddonPlans,
  getAddonAdmin,
  createAddon,
  createDashboardAddonPlan,
  updateAddon,
  deleteAddon,
  deleteDashboardAddonPlan,
  toggleAddonActive,
  updateAddonSortOrder,
  cloneAddon,
  listAddonPlansAdmin,
  getAddonPlanAdmin,
  createAddonPlan,
  updateAddonPlan,
  toggleAddonPlanActive,
  deleteAddonPlan,
  listAddonItemsAdmin,
  getAddonItemAdmin,
  createAddonItem,
  updateAddonItem,
  toggleAddonItemActive,
  deleteAddonItem,
  patchAddon,
  validateAddonPayloadOrThrow,
  resolvePublicAddonFilters,
};
