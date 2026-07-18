const constants = require("./dynamicMealPlanner/constants");
const core = require("./dynamicMealPlanner/core");
const compiler = require("./dynamicMealPlanner/compiler");
const lifecycle = require("./dynamicMealPlanner/lifecycle");

module.exports = {
  CONTRACT_VERSION: constants.CONTRACT_VERSION,
  DynamicMealPlannerError: constants.DynamicMealPlannerError,
  canonicalize: core.canonicalize,
  stableHash: core.stableHash,
  normalizeSection: core.normalizeSection,
  normalizeSections: core.normalizeSections,
  draftHashForSections: core.draftHashForSections,
  serializeConfig: core.serializeConfig,
  buildDefaultSections: compiler.buildDefaultSections,
  ...lifecycle,
};
