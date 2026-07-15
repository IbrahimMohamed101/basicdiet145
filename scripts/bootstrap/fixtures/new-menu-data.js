const categories = require("./new-menu-categories");
const mainCourses = require("./new-menu-main_courses");
const breakfast = require("./new-menu-breakfast");
const sandwiches = require("./new-menu-sandwiches");
const salads = require("./new-menu-salads");
const optionGroups = require("./new-menu-options");

module.exports = {
  source: "Basic Diet new menu workbook",
  categories,
  products: [...mainCourses, ...breakfast, ...sandwiches, ...salads],
  optionGroups,
};
