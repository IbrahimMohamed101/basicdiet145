#!/usr/bin/env python3
from pathlib import Path
import json


def read(path):
    return Path(path).read_text(encoding="utf-8")


def write(path, content):
    Path(path).write_text(content, encoding="utf-8")


def replace_once(path, old, new):
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, found {count}\n--- expected ---\n{old}")
    write(path, text.replace(old, new, 1))


# MenuProduct schema: persist an optional price for each configured weight step.
replace_once(
    "src/models/MenuProduct.js",
    '''const integerMinZero = {
  validator: Number.isInteger,
  message: "{PATH} must be an integer",
};
''',
    '''const integerMinZero = {
  validator: Number.isInteger,
  message: "{PATH} must be an integer",
};
const nullableIntegerMinZero = {
  validator: (value) => value === null || value === undefined || Number.isInteger(value),
  message: "{PATH} must be null or an integer",
};
'''
)
replace_once(
    "src/models/MenuProduct.js",
    '    weightStepGrams: { type: Number, min: 1, default: 50, validate: integerMinZero },\n',
    '    weightStepGrams: { type: Number, min: 1, default: 50, validate: integerMinZero },\n'
    '    weightStepPriceHalala: { type: Number, min: 0, default: null, validate: nullableIntegerMinZero },\n'
)

# Admin product create/update: accept the new field and validate the complete configuration.
replace_once(
    "src/services/orders/menuCatalogService.js",
    'const { validateMenuCatalog } = require("./menuCatalogValidationService");\n',
    'const { validateMenuCatalog } = require("./menuCatalogValidationService");\n'
    'const {\n'
    '  assertValidWeightPricingConfiguration,\n'
    '} = require("./weightPricingService");\n'
)
path = "src/services/orders/menuCatalogService.js"
text = read(path)
start = text.index("  function normalizeProductPayload")
end = text.index("  function normalizeGroupPayload", start)
region = text[start:end]
if region.count("    return {\n") != 1:
    raise RuntimeError("normalizeProductPayload return shape changed")
region = region.replace(
    "    return {\n",
    "    return assertValidWeightPricingConfiguration({\n",
    1,
)
old_weight_line = '      weightStepGrams: normalizeNonNegativeInteger(body.weightStepGrams, "weightStepGrams", existing ? existing.weightStepGrams : 50) || 50,\n'
if old_weight_line not in region:
    raise RuntimeError("normalizeProductPayload weightStepGrams line changed")
region = region.replace(
    old_weight_line,
    old_weight_line
    + '      weightStepPriceHalala: normalizeNullableNonNegativeInteger(\n'
      '        body.weightStepPriceHalala,\n'
      '        "weightStepPriceHalala",\n'
      '        existing ? (existing.weightStepPriceHalala ?? null) : null\n'
      '      ),\n',
    1,
)
closing = "    };\n  }\n\n"
if not region.endswith(closing):
    raise RuntimeError("normalizeProductPayload closing shape changed")
region = region[:-len(closing)] + "    });\n  }\n\n"
write(path, text[:start] + region + text[end:])

# Legacy public menu response remains additive and exposes the step price.
replace_once(
    "src/services/orders/menuCatalogPresenter.js",
    '    weightStepGrams: Number(product.weightStepGrams || 50),\n',
    '    weightStepGrams: Number(product.weightStepGrams || 50),\n'
    '    weightStepPriceHalala: product.weightStepPriceHalala === null || product.weightStepPriceHalala === undefined\n'
    '      ? null\n'
    '      : Number(product.weightStepPriceHalala),\n'
)

# Canonical publicMenuV2 pricing is fully backend-authored, including selectable choices.
replace_once(
    "src/services/orders/orderMenuService.js",
    '} = require("./menuCatalogService");\n',
    '} = require("./menuCatalogService");\n'
    'const { buildWeightPricingDescriptor } = require("./weightPricingService");\n'
)
replace_once(
    "src/services/orders/orderMenuService.js",
    '''function publicMenuPricingForProduct(product = {}) {
  return {
    model: product.pricingModel || "fixed",
    priceHalala: Number(product.priceHalala || 0),
    currency: product.currency || SYSTEM_CURRENCY,
    baseUnitGrams: Number(product.baseUnitGrams || 0),
    defaultWeightGrams: Number(product.defaultWeightGrams || 0),
    minWeightGrams: Number(product.minWeightGrams || 0),
    maxWeightGrams: Number(product.maxWeightGrams || 0),
    weightStepGrams: Number(product.weightStepGrams || 0),
  };
}
''',
    '''function publicMenuPricingForProduct(product = {}) {
  const weightPricing = buildWeightPricingDescriptor(product);
  return {
    model: product.pricingModel || "fixed",
    priceHalala: Number(product.priceHalala || 0),
    currency: product.currency || SYSTEM_CURRENCY,
    baseUnitGrams: Number(product.baseUnitGrams || 0),
    defaultWeightGrams: Number(product.defaultWeightGrams || 0),
    minWeightGrams: Number(product.minWeightGrams || 0),
    maxWeightGrams: Number(product.maxWeightGrams || 0),
    weightStepGrams: Number(product.weightStepGrams || 0),
    weightStepPriceHalala: product.weightStepPriceHalala === null || product.weightStepPriceHalala === undefined
      ? null
      : Number(product.weightStepPriceHalala),
    strategy: weightPricing.strategy,
    requiresWeightSelection: weightPricing.requiresWeightSelection,
    weightChoices: weightPricing.choices,
  };
}
'''
)

# Quote and order pricing delegate to the canonical service and persist an audit snapshot.
replace_once(
    "src/services/orders/menuPricingService.js",
    '} = require("../catalog/catalogAvailabilityService");\n',
    '} = require("../catalog/catalogAvailabilityService");\n'
    'const {\n'
    '  buildWeightPricingSnapshot,\n'
    '  computeProductBasePrice: computeCanonicalProductBasePrice,\n'
    '  resolveWeightGrams: resolveCanonicalWeightGrams,\n'
    '} = require("./weightPricingService");\n'
)
replace_once(
    "src/services/orders/menuPricingService.js",
    '''function resolveWeightGrams(item, product) {
  if (product.pricingModel !== "per_100g") return 0;
  const hasWeightGrams = Object.prototype.hasOwnProperty.call(item, "weightGrams");
  if (!hasWeightGrams || item.weightGrams === null || item.weightGrams === "") {
    throw createMenuPricingError("INVALID_WEIGHT_GRAMS", "weightGrams is required for per_100g products");
  }
  const weight = Number(item.weightGrams);
  if (!Number.isInteger(weight) || weight <= 0) {
    throw createMenuPricingError("INVALID_WEIGHT_GRAMS", "weightGrams must be a positive integer for per_100g products");
  }
  const min = Number(product.minWeightGrams || 0);
  const max = Number(product.maxWeightGrams || 0);
  const step = Number(product.weightStepGrams || 1);
  if (min && weight < min) throw createMenuPricingError("INVALID_WEIGHT_GRAMS", "weightGrams is below minimum");
  if (max && weight > max) throw createMenuPricingError("INVALID_WEIGHT_GRAMS", "weightGrams exceeds maximum");
  if (step && weight % step !== 0) {
    throw createMenuPricingError("INVALID_WEIGHT_GRAMS", "weightGrams must match product weight step");
  }
  return weight;
}

function computeProductBasePrice(product, weightGrams) {
  const priceHalala = Number(product.priceHalala || 0);
  if (product.pricingModel === "fixed") return priceHalala;
  const baseUnitGrams = Number(product.baseUnitGrams || 100);
  const units = Math.ceil(weightGrams / baseUnitGrams);
  return Math.max(0, units * priceHalala);
}
''',
    '''function resolveWeightGrams(item, product) {
  return resolveCanonicalWeightGrams(item, product);
}

function computeProductBasePrice(product, weightGrams) {
  return computeCanonicalProductBasePrice(product, weightGrams);
}
'''
)
replace_once(
    "src/services/orders/menuPricingService.js",
    '''      priceHalala: Number(product.priceHalala || 0),
      baseUnitGrams: Number(product.baseUnitGrams || 100),
      weightGrams,
''',
    '''      priceHalala: Number(product.priceHalala || 0),
      baseUnitGrams: Number(product.baseUnitGrams || 100),
      defaultWeightGrams: Number(product.defaultWeightGrams || 0),
      minWeightGrams: Number(product.minWeightGrams || 0),
      maxWeightGrams: Number(product.maxWeightGrams || 0),
      weightStepGrams: Number(product.weightStepGrams || 0),
      weightStepPriceHalala: product.weightStepPriceHalala === null || product.weightStepPriceHalala === undefined
        ? null
        : Number(product.weightStepPriceHalala),
      weightGrams,
'''
)
replace_once(
    "src/services/orders/menuPricingService.js",
    '''      lineTotalHalala,
      vatIncluded: true,
      currency: product.currency || SYSTEM_CURRENCY,
''',
    '''      lineTotalHalala,
      weightPricing: buildWeightPricingSnapshot(product, weightGrams, basePriceHalala),
      vatIncluded: true,
      currency: product.currency || SYSTEM_CURRENCY,
'''
)

# Catalog validation catches malformed step-pricing products before publication.
replace_once(
    "src/services/orders/menuCatalogValidationService.js",
    'const ProductOptionGroup = require("../../models/ProductOptionGroup");\n',
    'const ProductOptionGroup = require("../../models/ProductOptionGroup");\n'
    'const { assertValidWeightPricingConfiguration } = require("./weightPricingService");\n'
)
replace_once(
    "src/services/orders/menuCatalogValidationService.js",
    '''  products.forEach((p) => {
    if (p.isActive) {
      if (p.pricingModel === "fixed" && p.priceHalala <= 0) {
        errors.push(`Active fixed product ${p.key} must have priceHalala > 0`);
      }
      if (p.pricingModel === "per_100g" && (p.priceHalala <= 0 || p.baseUnitGrams <= 0)) {
        errors.push(`Active per_100g product ${p.key} must have priceHalala > 0 and baseUnitGrams > 0`);
      }
    }
  });
''',
    '''  products.forEach((p) => {
    if (p.isActive) {
      if (p.pricingModel === "fixed" && p.priceHalala <= 0) {
        errors.push(`Active fixed product ${p.key} must have priceHalala > 0`);
      }
      if (p.pricingModel === "per_100g" && (p.priceHalala <= 0 || p.baseUnitGrams <= 0)) {
        errors.push(`Active per_100g product ${p.key} must have priceHalala > 0 and baseUnitGrams > 0`);
      }
      try {
        assertValidWeightPricingConfiguration(p);
      } catch (err) {
        errors.push(`Product ${p.key} has invalid weight pricing: ${err.message}`);
      }
    }
  });
'''
)

# Add a focused test command and include it in backend release gates.
package_path = Path("package.json")
package = json.loads(package_path.read_text(encoding="utf-8"))
package["scripts"]["test:weight-pricing"] = "NODE_ENV=test node tests/weightStepPricingContract.test.js"
release_gates = package["scripts"].get("test:release-gates", "")
needle = "npm run test:one-time-menu &&"
if needle not in release_gates:
    raise RuntimeError("package.json release gate insertion point changed")
package["scripts"]["test:release-gates"] = release_gates.replace(
    needle,
    "npm run test:one-time-menu && npm run test:weight-pricing &&",
    1,
)
package_path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

# Backend contract handoff for Dashboard and Flutter implementation.
write(
    "docs/WEIGHT_STEP_PRICING_CONTRACT.md",
    '''# Weight Step Pricing Contract\n\nThe backend is the pricing authority for one-time products sold by weight.\n\n## Configuration\n\nFor `pricingModel: per_100g`, canonical step pricing is enabled when `weightStepPriceHalala` is present, including zero.\n\n- `priceHalala`: price at the base weight\n- `baseUnitGrams`: base weight receiving `priceHalala`\n- `defaultWeightGrams`: initially selected weight\n- `minWeightGrams`: first selectable weight; must equal `baseUnitGrams`\n- `maxWeightGrams`: final selectable weight\n- `weightStepGrams`: grams added per step\n- `weightStepPriceHalala`: price added per step\n\nExample: base 100g at 1900 halala, step 50g at 500 halala, maximum 300g produces 1900, 2400, 2900, 3400, and 3900 halala.\n\n## Public menu\n\nThe legacy product payload adds `weightStepPriceHalala`. `publicMenuV2.sections[].products[].pricing` additionally returns:\n\n- `strategy`: `base_plus_steps`, `legacy_per_unit`, or `fixed`\n- `requiresWeightSelection`\n- `weightStepPriceHalala`\n- `weightChoices`: backend-calculated `{ weightGrams, priceHalala }` rows\n\nClients should render choices from `weightChoices` and must use `/api/orders/quote` as the final price authority.\n\n## Quote request\n\nSend only the selected `weightGrams` with the product. The backend validates the range and step and returns the authoritative price.\n\n## Stored order snapshot\n\nEach weighted item stores the selected weight and a `pricingSnapshot.weightPricing` object containing the strategy, base weight and price, step grams and price, step count, and calculated weighted price.\n\n## Backward compatibility\n\nExisting `per_100g` products without `weightStepPriceHalala` retain the old per-unit calculation until explicitly migrated in Dashboard.\n'''
)

print("Weight step pricing patches applied successfully")
