const metadata = require("./menu-workbook-source/metadata.json");
const categories = require("./menu-workbook-source/categories.json");
const builderGroups = require("./menu-workbook-source/builder-groups.json");
const productCandidates = require("./menu-workbook-source/product-candidates.json");
const reviewItems = require("./menu-workbook-source/review-items.json");

const products = [
  ...require("./menu-workbook-source/products-breakfast.json"),
  ...require("./menu-workbook-source/products-meals-1.json"),
  ...require("./menu-workbook-source/products-meals-2.json"),
  ...require("./menu-workbook-source/products-sandwiches.json"),
  ...require("./menu-workbook-source/products-salads.json"),
  ...require("./menu-workbook-source/products-carbs.json"),
  ...require("./menu-workbook-source/products-greek_yogurt.json"),
  ...require("./menu-workbook-source/products-desserts.json"),
  ...require("./menu-workbook-source/products-ice_cream.json"),
  ...require("./menu-workbook-source/products-juices.json"),
  ...require("./menu-workbook-source/products-drinks.json"),
];

module.exports = {
  metadata,
  categories,
  products,
  builderGroups,
  productCandidates,
  reviewItems,
};
