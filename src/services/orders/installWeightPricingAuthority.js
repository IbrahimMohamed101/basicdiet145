const MenuProduct = require("../../models/MenuProduct");
const { computeInclusiveVatBreakdown } = require("../../utils/pricing");
const { VAT_PERCENTAGE } = require("../../config/vat");
const {
  assertValidWeightPricingConfiguration,
  buildWeightPricingDescriptor,
  buildWeightPricingSnapshot,
  computeProductBasePrice,
  hasConfiguredStepPrice,
  resolveWeightGrams,
} = require("./weightPricingService");

let installed = false;

function productIdOf(value) {
  return String(
    (value && value.productId)
    || (value && value.menuProductId)
    || (value && value.catalogRef && value.catalogRef.id)
    || ""
  );
}

function enrichPublicProduct(product = {}) {
  const descriptor = buildWeightPricingDescriptor(product);
  return {
    ...product,
    weightStepPriceHalala: product.weightStepPriceHalala === null || product.weightStepPriceHalala === undefined
      ? null
      : Number(product.weightStepPriceHalala),
    weightPricing: descriptor,
  };
}

function installCatalogValidationAuthority() {
  const validationService = require("./menuCatalogValidationService");
  const originalValidateMenuCatalog = validationService.validateMenuCatalog;
  if (originalValidateMenuCatalog.__weightPricingWrapped) return;

  const wrapped = async function validateMenuCatalogWithWeightPricing() {
    const result = await originalValidateMenuCatalog();
    const products = await MenuProduct.find({}).lean();
    const errors = Array.isArray(result.errors) ? [...result.errors] : [];

    for (const product of products) {
      if (product.isActive === false) continue;
      try {
        assertValidWeightPricingConfiguration(product);
      } catch (err) {
        errors.push(`Product ${product.key || product._id} has invalid weight pricing: ${err.message}`);
      }
    }

    return {
      ...result,
      ok: errors.length === 0,
      errors,
    };
  };
  wrapped.__weightPricingWrapped = true;
  validationService.validateMenuCatalog = wrapped;
}

function installMenuPricingAuthority() {
  const menuPricingService = require("./menuPricingService");
  const originalPriceMenuCart = menuPricingService.priceMenuCart;
  if (originalPriceMenuCart.__weightPricingWrapped) return;

  const wrapped = async function priceMenuCartWithWeightAuthority(args = {}) {
    const result = await originalPriceMenuCart(args);
    const inputItems = Array.isArray(args.items) ? args.items : [];
    const pricedItems = Array.isArray(result.items) ? result.items : [];
    const productIds = [...new Set(inputItems.map(productIdOf).filter(Boolean))];
    const products = productIds.length
      ? await MenuProduct.find({ _id: { $in: productIds } }).lean()
      : [];
    const productsById = new Map(products.map((product) => [String(product._id), product]));

    for (let index = 0; index < pricedItems.length; index += 1) {
      const inputItem = inputItems[index] || {};
      const pricedItem = pricedItems[index];
      const product = productsById.get(productIdOf(inputItem))
        || productsById.get(productIdOf(pricedItem));
      if (!product || !hasConfiguredStepPrice(product)) continue;

      const selectedWeightGrams = resolveWeightGrams(inputItem, product);
      const weightedBasePriceHalala = computeProductBasePrice(product, selectedWeightGrams);
      const optionsTotalHalala = Number(
        pricedItem
        && pricedItem.pricingSnapshot
        && pricedItem.pricingSnapshot.optionsTotalHalala
        || 0
      );
      const qty = Math.max(1, Number(pricedItem.qty || inputItem.qty || 1));
      const unitPriceHalala = weightedBasePriceHalala + optionsTotalHalala;
      const lineTotalHalala = unitPriceHalala * qty;

      pricedItem.weightGrams = selectedWeightGrams;
      pricedItem.unitPriceHalala = unitPriceHalala;
      pricedItem.lineTotalHalala = lineTotalHalala;
      pricedItem.productSnapshot = {
        ...(pricedItem.productSnapshot || {}),
        pricingModel: product.pricingModel,
        priceHalala: Number(product.priceHalala || 0),
        baseUnitGrams: Number(product.baseUnitGrams || 0),
        defaultWeightGrams: Number(product.defaultWeightGrams || 0),
        minWeightGrams: Number(product.minWeightGrams || 0),
        maxWeightGrams: Number(product.maxWeightGrams || 0),
        weightStepGrams: Number(product.weightStepGrams || 0),
        weightStepPriceHalala: Number(product.weightStepPriceHalala || 0),
        weightGrams: selectedWeightGrams,
      };
      pricedItem.pricingSnapshot = {
        ...(pricedItem.pricingSnapshot || {}),
        basePriceHalala: weightedBasePriceHalala,
        optionsTotalHalala,
        unitPriceHalala,
        lineTotalHalala,
        weightPricing: buildWeightPricingSnapshot(
          product,
          selectedWeightGrams,
          weightedBasePriceHalala
        ),
      };
    }

    const subtotalHalala = pricedItems.reduce(
      (sum, item) => sum + Number(item.lineTotalHalala || 0),
      0
    );
    const deliveryFeeHalala = Number(result.pricing && result.pricing.deliveryFeeHalala || 0);
    const discountHalala = Number(result.pricing && result.pricing.discountHalala || 0);
    const totalHalala = Math.max(0, subtotalHalala + deliveryFeeHalala - discountHalala);
    const vatPercentage = Number(result.pricing && result.pricing.vatPercentage || VAT_PERCENTAGE);
    const vat = computeInclusiveVatBreakdown(totalHalala, vatPercentage);

    result.items = pricedItems;
    result.pricing = {
      ...(result.pricing || {}),
      subtotalHalala,
      totalHalala,
      vatPercentage: vat.vatPercentage,
      vatHalala: vat.vatHalala,
      vatIncluded: true,
    };
    return result;
  };
  wrapped.__weightPricingWrapped = true;
  menuPricingService.priceMenuCart = wrapped;
}

function installPublicMenuAuthority() {
  const orderMenuService = require("./orderMenuService");
  const originalGetOneTimeOrderMenu = orderMenuService.getOneTimeOrderMenu;
  if (originalGetOneTimeOrderMenu.__weightPricingWrapped) return;

  const wrapped = async function getOneTimeOrderMenuWithWeightAuthority(args = {}) {
    const payload = await originalGetOneTimeOrderMenu(args);
    const productsById = new Map();
    const productsByKey = new Map();

    if (Array.isArray(payload.categories)) {
      payload.categories = payload.categories.map((category) => ({
        ...category,
        products: (category.products || []).map((product) => {
          const enriched = enrichPublicProduct(product);
          productsById.set(String(enriched.id || ""), enriched);
          productsByKey.set(String(enriched.key || ""), enriched);
          return enriched;
        }),
      }));
    }

    if (payload.publicMenuV2 && Array.isArray(payload.publicMenuV2.sections)) {
      payload.publicMenuV2.sections = payload.publicMenuV2.sections.map((section) => ({
        ...section,
        products: (section.products || []).map((product) => {
          const source = productsById.get(String(product.id || ""))
            || productsByKey.get(String(product.key || ""))
            || product;
          const descriptor = source.weightPricing || buildWeightPricingDescriptor(source);
          return {
            ...product,
            pricing: {
              ...(product.pricing || {}),
              weightStepPriceHalala: descriptor.stepPriceHalala,
              strategy: descriptor.strategy,
              requiresWeightSelection: descriptor.requiresWeightSelection,
              weightChoices: descriptor.choices,
              weightPricingContractVersion: descriptor.contractVersion,
            },
          };
        }),
      }));
    }

    return payload;
  };
  wrapped.__weightPricingWrapped = true;
  orderMenuService.getOneTimeOrderMenu = wrapped;
}

function installWeightPricingAuthority() {
  if (installed) return;
  installCatalogValidationAuthority();
  installMenuPricingAuthority();
  installPublicMenuAuthority();
  installed = true;
}

installWeightPricingAuthority();

module.exports = {
  installWeightPricingAuthority,
};
