#!/usr/bin/env node
"use strict";

const path = require("path");
const mongoose = require("mongoose");

require("dotenv").config({ path: path.join(__dirname, "../.env") });

const MenuCategory = require("../src/models/MenuCategory");
const MenuProduct = require("../src/models/MenuProduct");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const MenuOption = require("../src/models/MenuOption");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const Order = require("../src/models/Order");
const Payment = require("../src/models/Payment");
const Subscription = require("../src/models/Subscription");

const REQUIRED_FLAG = process.env.VALIDATE_DATA_INTEGRITY === "true";
const READ_ONLY_PRODUCTION_AUDIT = process.env.READ_ONLY_PRODUCTION_AUDIT === "true";
const NODE_ENV = String(process.env.NODE_ENV || "").toLowerCase();
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || "";

const issues = [];
const warnings = [];

function addIssue(message) {
  issues.push(message);
  console.error(`FAIL: ${message}`);
}

function addWarning(message) {
  warnings.push(message);
  console.warn(`WARN: ${message}`);
}

function pass(message) {
  console.log(`PASS: ${message}`);
}

function requireGuardrails() {
  if (!REQUIRED_FLAG) {
    console.error("Refusing to run. Set VALIDATE_DATA_INTEGRITY=true for this read-only audit.");
    process.exit(1);
  }
  if (!MONGO_URI) {
    console.error("MONGO_URI or MONGODB_URI is required. The value will not be printed.");
    process.exit(1);
  }
  if (NODE_ENV === "production" && !READ_ONLY_PRODUCTION_AUDIT) {
    console.error("Refusing to run on NODE_ENV=production without READ_ONLY_PRODUCTION_AUDIT=true.");
    process.exit(1);
  }
}

function isActiveVisibleAvailable(doc) {
  return doc && doc.isActive === true && doc.isVisible === true && doc.isAvailable === true;
}

function isPublished(doc) {
  return Boolean(doc && doc.publishedAt);
}

function isNonNegativeInteger(value) {
  return Number.isInteger(Number(value)) && Number(value) >= 0;
}

function checkDuplicateKeys(rows, keyFn, label) {
  const counts = new Map();
  rows.forEach((row) => {
    const key = keyFn(row);
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const duplicates = [...counts.entries()].filter(([, count]) => count > 1);
  duplicates.forEach(([key, count]) => addIssue(`${label} duplicate key "${key}" appears ${count} times`));
  if (duplicates.length === 0) pass(`${label} duplicate key check`);
}

function checkMenuCatalog({ categories, products, groups, options, productGroups, productOptions }) {
  const categoryIds = new Set(categories.map((row) => String(row._id)));
  const productIds = new Set(products.map((row) => String(row._id)));
  const groupIds = new Set(groups.map((row) => String(row._id)));
  const optionIds = new Set(options.map((row) => String(row._id)));

  checkDuplicateKeys(categories, (row) => row.key, "MenuCategory");
  checkDuplicateKeys(products, (row) => row.key, "MenuProduct");
  checkDuplicateKeys(groups, (row) => row.key, "MenuOptionGroup");
  checkDuplicateKeys(options, (row) => `${row.groupId}:${row.key}`, "MenuOption");
  checkDuplicateKeys(productGroups, (row) => `${row.productId}:${row.groupId}`, "ProductOptionGroup");
  checkDuplicateKeys(productOptions, (row) => `${row.productId}:${row.groupId}:${row.optionId}`, "ProductGroupOption");

  products.forEach((product) => {
    const label = `product ${product.key || product._id}`;
    if (!categoryIds.has(String(product.categoryId))) addIssue(`${label} references missing categoryId`);
    if (!isNonNegativeInteger(product.priceHalala)) addIssue(`${label} priceHalala must be non-negative integer`);
    if (product.currency && product.currency !== "SAR") addIssue(`${label} currency must be SAR`);
    if (product.pricingModel === "per_100g") {
      ["baseUnitGrams", "defaultWeightGrams", "minWeightGrams", "maxWeightGrams", "weightStepGrams"].forEach((field) => {
        if (!isNonNegativeInteger(product[field])) addIssue(`${label} ${field} must be integer`);
      });
      if (Number(product.baseUnitGrams || 0) <= 0) addIssue(`${label} baseUnitGrams must be > 0`);
      if (Number(product.weightStepGrams || 0) <= 0) addIssue(`${label} weightStepGrams must be > 0`);
      if (Number(product.defaultWeightGrams || 0) < Number(product.minWeightGrams || 0)) {
        addIssue(`${label} defaultWeightGrams must be >= minWeightGrams`);
      }
    }
    if (isActiveVisibleAvailable(product) && isPublished(product)) {
      const category = categories.find((row) => String(row._id) === String(product.categoryId));
      if (!isActiveVisibleAvailable(category) || !isPublished(category)) {
        addIssue(`${label} is published/active but category is not published/active`);
      }
    }
  });
  pass("menu product field checks completed");

  options.forEach((option) => {
    const label = `option ${option.key || option._id}`;
    if (!groupIds.has(String(option.groupId))) addIssue(`${label} references missing groupId`);
    ["extraPriceHalala", "extraWeightUnitGrams", "extraWeightPriceHalala"].forEach((field) => {
      if (!isNonNegativeInteger(option[field])) addIssue(`${label} ${field} must be non-negative integer`);
    });
    if (option.currency && option.currency !== "SAR") addIssue(`${label} currency must be SAR`);
  });
  pass("menu option field checks completed");

  productGroups.forEach((relation) => {
    const label = `product-group relation ${relation._id}`;
    if (!productIds.has(String(relation.productId))) addIssue(`${label} references missing productId`);
    if (!groupIds.has(String(relation.groupId))) addIssue(`${label} references missing groupId`);
    if (!isNonNegativeInteger(relation.minSelections || 0)) addIssue(`${label} minSelections must be integer`);
    if (relation.maxSelections !== null && relation.maxSelections !== undefined && !isNonNegativeInteger(relation.maxSelections)) {
      addIssue(`${label} maxSelections must be integer or null`);
    }
    if (
      relation.maxSelections !== null
      && relation.maxSelections !== undefined
      && Number(relation.maxSelections) < Number(relation.minSelections || 0)
    ) {
      addIssue(`${label} maxSelections must be >= minSelections`);
    }
  });
  pass("product option-group relation checks completed");

  productOptions.forEach((relation) => {
    const label = `product-group-option relation ${relation._id}`;
    if (!productIds.has(String(relation.productId))) addIssue(`${label} references missing productId`);
    if (!groupIds.has(String(relation.groupId))) addIssue(`${label} references missing groupId`);
    if (!optionIds.has(String(relation.optionId))) addIssue(`${label} references missing optionId`);
    const option = options.find((row) => String(row._id) === String(relation.optionId));
    if (option && String(option.groupId) !== String(relation.groupId)) {
      addIssue(`${label} option belongs to a different group`);
    }
    ["extraPriceHalala", "extraWeightPriceHalala"].forEach((field) => {
      if (relation[field] !== null && relation[field] !== undefined && !isNonNegativeInteger(relation[field])) {
        addIssue(`${label} ${field} must be integer or null`);
      }
    });
  });
  pass("product-group-option relation checks completed");

  products
    .filter((product) => isActiveVisibleAvailable(product) && isPublished(product))
    .forEach((product) => {
      const groupsForProduct = productGroups.filter((row) => String(row.productId) === String(product._id) && isActiveVisibleAvailable(row));
      groupsForProduct.forEach((relation) => {
        const optionsForRelation = productOptions.filter((row) => (
          String(row.productId) === String(product._id)
          && String(row.groupId) === String(relation.groupId)
          && isActiveVisibleAvailable(row)
        ));
        if (Number(relation.minSelections || 0) > 0 && optionsForRelation.length < Number(relation.minSelections)) {
          addIssue(`product ${product.key} requires ${relation.minSelections} options for group ${relation.groupId} but has ${optionsForRelation.length}`);
        }
      });
    });
  pass("published menu relation viability checks completed");
}

async function checkOrdersPayments() {
  const recentOrders = await Order.find({}).sort({ createdAt: -1 }).limit(500).lean();
  const orderIds = recentOrders.map((order) => order._id);
  const payments = await Payment.find({
    $or: [
      { orderId: { $in: orderIds } },
      { type: "one_time_order" },
    ],
  }).sort({ createdAt: -1 }).limit(1000).lean();
  const paymentsById = new Map(payments.map((payment) => [String(payment._id), payment]));
  const ordersById = new Map(recentOrders.map((order) => [String(order._id), order]));

  recentOrders.forEach((order) => {
    const label = `order ${order.orderNumber || order._id}`;
    if (order.pricing) {
      ["subtotalHalala", "deliveryFeeHalala", "discountHalala", "totalHalala", "vatHalala"].forEach((field) => {
        if (!isNonNegativeInteger(order.pricing[field] || 0)) addIssue(`${label} pricing.${field} must be integer Halala`);
      });
    }
    (order.items || []).forEach((item, index) => {
      ["unitPriceHalala", "lineTotalHalala"].forEach((field) => {
        if (!isNonNegativeInteger(item[field] || 0)) addIssue(`${label} item[${index}].${field} must be integer Halala`);
      });
    });
    if (order.paymentId) {
      const payment = paymentsById.get(String(order.paymentId));
      if (!payment) addWarning(`${label} paymentId was not found in sampled payments`);
      if (payment && String(payment.orderId || "") !== String(order._id)) addIssue(`${label} paymentId points to payment for another order`);
    }
    if (order.paymentStatus === "paid" && order.paymentId) {
      const payment = paymentsById.get(String(order.paymentId));
      if (payment && payment.status !== "paid") addIssue(`${label} is paid but linked payment is ${payment.status}`);
    }
  });

  payments.forEach((payment) => {
    const label = `payment ${payment._id}`;
    if (!isNonNegativeInteger(payment.amount)) addIssue(`${label} amount must be integer Halala`);
    if (payment.currency && payment.currency !== "SAR") addIssue(`${label} currency must be SAR`);
    if (payment.type === "one_time_order" && payment.orderId && !ordersById.has(String(payment.orderId))) {
      addWarning(`${label} references order outside recent 500-order sample`);
    }
    if (payment.status === "paid" && payment.applied !== true) {
      addWarning(`${label} is paid but applied is not true`);
    }
  });
  pass("recent order/payment consistency checks completed");
}

async function checkSubscriptionBalances() {
  const activeSubscriptions = await Subscription.find({ status: "active" })
    .select("userId totalMeals remainingMeals entitlementVersion reservedMeals consumedMeals forfeitedMeals premiumBalance addonBalance")
    .limit(5000)
    .lean();

  if (activeSubscriptions.length === 5000) {
    addWarning("Subscription balance audit reached its 5000-row safety limit");
  }

  const activeByUser = new Map();
  activeSubscriptions.forEach((subscription) => {
    const label = `subscription ${subscription._id}`;
    const userId = String(subscription.userId || "");
    activeByUser.set(userId, (activeByUser.get(userId) || 0) + 1);

    const totalMeals = Number(subscription.totalMeals || 0);
    const remainingMeals = Number(subscription.remainingMeals || 0);
    [
      ["totalMeals", totalMeals],
      ["remainingMeals", remainingMeals],
    ].forEach(([field, value]) => {
      if (!isNonNegativeInteger(value)) addIssue(`${label} ${field} must be a non-negative integer`);
    });

    const premiumRemaining = (subscription.premiumBalance || []).reduce(
      (sum, row) => sum + Number(row.remainingQty || 0),
      0
    );
    if (premiumRemaining > remainingMeals) {
      addIssue(`${label} Premium remaining (${premiumRemaining}) exceeds base remainingMeals (${remainingMeals})`);
    }

    (subscription.premiumBalance || []).forEach((row, index) => {
      const purchased = Number(row.purchasedQty || 0);
      const actual = Number(row.remainingQty || 0) + Number(row.reservedQty || 0) + Number(row.consumedQty || 0);
      if (![row.purchasedQty, row.remainingQty, row.reservedQty, row.consumedQty].every((value) => isNonNegativeInteger(value || 0))) {
        addIssue(`${label} premiumBalance[${index}] contains a negative or non-integer quantity`);
      } else if (purchased !== actual) {
        addIssue(`${label} premiumBalance[${index}] purchasedQty=${purchased} but remaining+reserved+consumed=${actual}`);
      }
    });

    (subscription.addonBalance || []).forEach((row, index) => {
      const purchased = Math.max(
        Number(row.purchasedQty || 0),
        Number(row.includedTotalQty || 0) + Number(row.extraPurchasedQty || 0)
      );
      const actual = Number(row.remainingQty || 0) + Number(row.reservedQty || 0) + Number(row.consumedQty || 0);
      if ([row.purchasedQty, row.includedTotalQty, row.extraPurchasedQty, row.remainingQty, row.reservedQty, row.consumedQty]
        .some((value) => !isNonNegativeInteger(value || 0))) {
        addIssue(`${label} addonBalance[${index}] contains a negative or non-integer quantity`);
      } else if (purchased !== actual) {
        addIssue(`${label} addonBalance[${index}] purchasedQty=${purchased} but remaining+reserved+consumed=${actual}`);
      }
    });

    if (Number(subscription.entitlementVersion || 0) >= 2) {
      const reservedMeals = Number(subscription.reservedMeals || 0);
      const consumedMeals = Number(subscription.consumedMeals || 0);
      const forfeitedMeals = Number(subscription.forfeitedMeals || 0);
      if (![reservedMeals, consumedMeals, forfeitedMeals].every(isNonNegativeInteger)) {
        addIssue(`${label} canonical meal ledger contains a negative or non-integer quantity`);
      } else {
        const ledgerTotal = remainingMeals + reservedMeals + consumedMeals + forfeitedMeals;
        if (totalMeals !== ledgerTotal) {
          addIssue(`${label} totalMeals=${totalMeals} but remaining+reserved+consumed+forfeited=${ledgerTotal}`);
        }
      }
    }
  });

  [...activeByUser.entries()]
    .filter(([userId, count]) => userId && count > 1)
    .forEach(([userId, count]) => addIssue(`user ${userId} has ${count} active subscriptions`));

  pass(`active subscription balance checks completed (${activeSubscriptions.length} rows)`);
}

async function main() {
  requireGuardrails();
  console.log("BasicDiet read-only data integrity validation");
  console.log("Mongo URI is intentionally not printed.");

  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  try {
    const [categories, products, groups, options, productGroups, productOptions] = await Promise.all([
      MenuCategory.find({}).lean(),
      MenuProduct.find({}).lean(),
      MenuOptionGroup.find({}).lean(),
      MenuOption.find({}).lean(),
      ProductOptionGroup.find({}).lean(),
      ProductGroupOption.find({}).lean(),
    ]);

    checkMenuCatalog({ categories, products, groups, options, productGroups, productOptions });
    await checkOrdersPayments();
    await checkSubscriptionBalances();

    console.log(`\nWarnings: ${warnings.length}`);
    console.log(`Issues: ${issues.length}`);
    if (issues.length > 0) process.exitCode = 1;
    else console.log("Data integrity validation passed.");
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(async (err) => {
  console.error(`Data integrity validation failed: ${err && err.message ? err.message : err}`);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
