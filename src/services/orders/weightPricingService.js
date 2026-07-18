const MAX_WEIGHT_CHOICES = 200;

function createWeightPricingError(code, message, details) {
  const err = new Error(message);
  err.code = code;
  err.status = 400;
  if (details !== undefined) err.details = details;
  return err;
}

function hasConfiguredStepPrice(product = {}) {
  return product.pricingModel === "per_100g"
    && product.weightStepPriceHalala !== null
    && product.weightStepPriceHalala !== undefined;
}

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readWeightConfig(product = {}) {
  return {
    pricingModel: String(product.pricingModel || "fixed"),
    basePriceHalala: numberOrZero(product.priceHalala),
    baseWeightGrams: numberOrZero(product.baseUnitGrams),
    defaultWeightGrams: numberOrZero(product.defaultWeightGrams),
    minWeightGrams: numberOrZero(product.minWeightGrams),
    maxWeightGrams: numberOrZero(product.maxWeightGrams),
    stepGrams: numberOrZero(product.weightStepGrams),
    stepPriceHalala: hasConfiguredStepPrice(product)
      ? numberOrZero(product.weightStepPriceHalala)
      : null,
  };
}

function assertIntegerAtLeast(value, minimum, fieldName) {
  if (!Number.isInteger(value) || value < minimum) {
    throw createWeightPricingError(
      "INVALID_WEIGHT_PRICING_CONFIGURATION",
      `${fieldName} must be an integer >= ${minimum}`,
      { field: fieldName, value }
    );
  }
}

function assertValidWeightPricingConfiguration(product = {}) {
  const config = readWeightConfig(product);
  const stepPricingEnabled = hasConfiguredStepPrice(product);

  if (config.pricingModel !== "per_100g") {
    if (stepPricingEnabled) {
      throw createWeightPricingError(
        "INVALID_WEIGHT_PRICING_CONFIGURATION",
        "weightStepPriceHalala is only allowed for per_100g products",
        { field: "weightStepPriceHalala" }
      );
    }
    return product;
  }

  // Existing per_100g products without a step price keep the legacy pricing
  // formula until an administrator explicitly configures canonical step pricing.
  if (!stepPricingEnabled) return product;

  assertIntegerAtLeast(config.basePriceHalala, 0, "priceHalala");
  assertIntegerAtLeast(config.baseWeightGrams, 1, "baseUnitGrams");
  assertIntegerAtLeast(config.defaultWeightGrams, 1, "defaultWeightGrams");
  assertIntegerAtLeast(config.minWeightGrams, 1, "minWeightGrams");
  assertIntegerAtLeast(config.maxWeightGrams, 1, "maxWeightGrams");
  assertIntegerAtLeast(config.stepGrams, 1, "weightStepGrams");
  assertIntegerAtLeast(config.stepPriceHalala, 0, "weightStepPriceHalala");

  if (config.minWeightGrams !== config.baseWeightGrams) {
    throw createWeightPricingError(
      "INVALID_WEIGHT_PRICING_CONFIGURATION",
      "minWeightGrams must equal baseUnitGrams for base-plus-step pricing",
      {
        baseUnitGrams: config.baseWeightGrams,
        minWeightGrams: config.minWeightGrams,
      }
    );
  }

  if (config.maxWeightGrams < config.minWeightGrams) {
    throw createWeightPricingError(
      "INVALID_WEIGHT_PRICING_CONFIGURATION",
      "maxWeightGrams must be greater than or equal to minWeightGrams"
    );
  }

  if (
    config.defaultWeightGrams < config.minWeightGrams
    || config.defaultWeightGrams > config.maxWeightGrams
  ) {
    throw createWeightPricingError(
      "INVALID_WEIGHT_PRICING_CONFIGURATION",
      "defaultWeightGrams must be inside the configured weight range"
    );
  }

  if ((config.maxWeightGrams - config.minWeightGrams) % config.stepGrams !== 0) {
    throw createWeightPricingError(
      "INVALID_WEIGHT_PRICING_CONFIGURATION",
      "The configured weight range must divide evenly by weightStepGrams"
    );
  }

  if ((config.defaultWeightGrams - config.minWeightGrams) % config.stepGrams !== 0) {
    throw createWeightPricingError(
      "INVALID_WEIGHT_PRICING_CONFIGURATION",
      "defaultWeightGrams must fall on a configured weight step"
    );
  }

  const choicesCount = ((config.maxWeightGrams - config.minWeightGrams) / config.stepGrams) + 1;
  if (choicesCount > MAX_WEIGHT_CHOICES) {
    throw createWeightPricingError(
      "INVALID_WEIGHT_PRICING_CONFIGURATION",
      `Weight pricing cannot expose more than ${MAX_WEIGHT_CHOICES} choices`,
      { choicesCount }
    );
  }

  return product;
}

function resolveWeightGrams(item = {}, product = {}) {
  if (product.pricingModel !== "per_100g") return 0;

  const hasWeightGrams = Object.prototype.hasOwnProperty.call(item, "weightGrams");
  if (!hasWeightGrams || item.weightGrams === null || item.weightGrams === "") {
    throw createWeightPricingError(
      "INVALID_WEIGHT_GRAMS",
      "weightGrams is required for per_100g products"
    );
  }

  const weight = Number(item.weightGrams);
  if (!Number.isInteger(weight) || weight <= 0) {
    throw createWeightPricingError(
      "INVALID_WEIGHT_GRAMS",
      "weightGrams must be a positive integer for per_100g products"
    );
  }

  if (hasConfiguredStepPrice(product)) {
    assertValidWeightPricingConfiguration(product);
  }

  const config = readWeightConfig(product);
  const minimum = config.minWeightGrams || config.baseWeightGrams;
  const maximum = config.maxWeightGrams;
  const step = config.stepGrams || 1;

  if (minimum && weight < minimum) {
    throw createWeightPricingError("INVALID_WEIGHT_GRAMS", "weightGrams is below minimum");
  }
  if (maximum && weight > maximum) {
    throw createWeightPricingError("INVALID_WEIGHT_GRAMS", "weightGrams exceeds maximum");
  }
  if (step && (weight - minimum) % step !== 0) {
    throw createWeightPricingError(
      "INVALID_WEIGHT_GRAMS",
      "weightGrams must match the configured product weight steps"
    );
  }

  return weight;
}

function computeProductBasePrice(product = {}, weightGrams = 0) {
  const config = readWeightConfig(product);
  if (config.pricingModel === "fixed") return config.basePriceHalala;

  if (hasConfiguredStepPrice(product)) {
    assertValidWeightPricingConfiguration(product);
    const stepCount = (Number(weightGrams) - config.baseWeightGrams) / config.stepGrams;
    if (!Number.isInteger(stepCount) || stepCount < 0) {
      throw createWeightPricingError(
        "INVALID_WEIGHT_GRAMS",
        "weightGrams does not align with the configured base weight and step"
      );
    }
    return config.basePriceHalala + (stepCount * config.stepPriceHalala);
  }

  // Backward-compatible legacy calculation for products that have not yet been
  // migrated to weightStepPriceHalala.
  const baseUnitGrams = config.baseWeightGrams || 100;
  const units = Math.ceil(Number(weightGrams) / baseUnitGrams);
  return Math.max(0, units * config.basePriceHalala);
}

function buildWeightPricingDescriptor(product = {}) {
  const config = readWeightConfig(product);
  if (config.pricingModel !== "per_100g") {
    return {
      contractVersion: "weight_pricing.v1",
      strategy: "fixed",
      requiresWeightSelection: false,
      basePriceHalala: config.basePriceHalala,
      baseWeightGrams: 0,
      defaultWeightGrams: 0,
      minWeightGrams: 0,
      maxWeightGrams: 0,
      stepGrams: 0,
      stepPriceHalala: null,
      choices: [],
    };
  }

  const stepPricingEnabled = hasConfiguredStepPrice(product);
  if (stepPricingEnabled) assertValidWeightPricingConfiguration(product);

  const strategy = stepPricingEnabled ? "base_plus_steps" : "legacy_per_unit";
  const choices = [];
  if (
    config.minWeightGrams > 0
    && config.maxWeightGrams >= config.minWeightGrams
    && config.stepGrams > 0
  ) {
    const count = ((config.maxWeightGrams - config.minWeightGrams) / config.stepGrams) + 1;
    if (Number.isInteger(count) && count > 0 && count <= MAX_WEIGHT_CHOICES) {
      for (
        let weight = config.minWeightGrams;
        weight <= config.maxWeightGrams;
        weight += config.stepGrams
      ) {
        choices.push({
          weightGrams: weight,
          priceHalala: computeProductBasePrice(product, weight),
        });
      }
    }
  }

  return {
    contractVersion: "weight_pricing.v1",
    strategy,
    requiresWeightSelection: true,
    basePriceHalala: config.basePriceHalala,
    baseWeightGrams: config.baseWeightGrams,
    defaultWeightGrams: config.defaultWeightGrams || config.minWeightGrams || config.baseWeightGrams,
    minWeightGrams: config.minWeightGrams,
    maxWeightGrams: config.maxWeightGrams,
    stepGrams: config.stepGrams,
    stepPriceHalala: config.stepPriceHalala,
    choices,
  };
}

function buildWeightPricingSnapshot(product = {}, selectedWeightGrams = 0, calculatedPriceHalala = 0) {
  if (product.pricingModel !== "per_100g") return null;
  const descriptor = buildWeightPricingDescriptor(product);
  const stepCount = descriptor.strategy === "base_plus_steps"
    ? (Number(selectedWeightGrams) - descriptor.baseWeightGrams) / descriptor.stepGrams
    : null;
  return {
    contractVersion: descriptor.contractVersion,
    strategy: descriptor.strategy,
    selectedWeightGrams: Number(selectedWeightGrams || 0),
    baseWeightGrams: descriptor.baseWeightGrams,
    basePriceHalala: descriptor.basePriceHalala,
    stepGrams: descriptor.stepGrams,
    stepPriceHalala: descriptor.stepPriceHalala,
    stepCount: Number.isInteger(stepCount) ? stepCount : null,
    calculatedPriceHalala: Number(calculatedPriceHalala || 0),
  };
}

module.exports = {
  assertValidWeightPricingConfiguration,
  buildWeightPricingDescriptor,
  buildWeightPricingSnapshot,
  computeProductBasePrice,
  createWeightPricingError,
  hasConfiguredStepPrice,
  resolveWeightGrams,
};
