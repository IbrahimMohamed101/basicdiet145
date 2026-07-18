const CONTRACT_VERSION = "meal_planner_menu.v4";
const CONFIG_VERSION = CONTRACT_VERSION;
const SYSTEM_CURRENCY = "SAR";
const SECTION_TYPES = new Set(["option_group", "product_category", "product_list"]);
const SOURCE_KINDS = new Set(["", "visual_family", "configurable_product", "product_list", "premium_visual"]);
const MAX_SECTIONS = 100;
const MAX_PICKER_LIMIT = 1000;

class DynamicMealPlannerError extends Error {
  constructor(message, code = "MEAL_PLANNER_ERROR", status = 400, details = undefined) {
    super(message);
    this.name = "DynamicMealPlannerError";
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

module.exports = {
  CONTRACT_VERSION,
  CONFIG_VERSION,
  SYSTEM_CURRENCY,
  SECTION_TYPES,
  SOURCE_KINDS,
  MAX_SECTIONS,
  MAX_PICKER_LIMIT,
  DynamicMealPlannerError,
};
