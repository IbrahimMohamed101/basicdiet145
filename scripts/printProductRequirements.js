/**
 * Command-line utility to print product requirements for meal planner.
 * Usage: node scripts/printProductRequirements.js PRODUCT_ID
 */

require("dotenv").config();
const mongoose = require("mongoose");

const MenuProduct = require("../src/models/MenuProduct");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const MenuOption = require("../src/models/MenuOption");

async function main() {
  const productId = process.argv[2];
  if (!productId) {
    console.error("Error: Please provide a PRODUCT_ID");
    console.error("Usage: node scripts/printProductRequirements.js PRODUCT_ID");
    process.exit(1);
  }

  if (!mongoose.Types.ObjectId.isValid(productId)) {
    console.error("Error: Invalid PRODUCT_ID format");
    process.exit(1);
  }

  // Connect to database
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.MONGO_URL || process.env.MONGO_URI_TEST;
  if (!mongoUri) {
    console.error("Error: MONGO_URI, MONGODB_URI, MONGO_URL, or MONGO_URI_TEST is required");
    process.exit(1);
  }
  console.log("Connecting to database...");
  await mongoose.connect(mongoUri);

  try {
    const product = await MenuProduct.findById(productId).lean();
    if (!product) {
      console.error(`Error: Product not found with ID ${productId}`);
      process.exit(1);
    }

    console.log(`\n=================================================`);
    console.log(`PRODUCT REQUIREMENTS REPORT`);
    console.log(`=================================================`);
    console.log(`Product Name (EN): ${product.name?.en || "(No English name)"}`);
    console.log(`Product Name (AR): ${product.name?.ar || "(No Arabic name)"}`);
    console.log(`Product ID:        ${product._id}`);
    console.log(`Selection Type:    ${product.selectionType || "sandwich (default)"}`);
    console.log(`Available for Sub: ${product.availableForSubscription !== false}`);

    // Load group relations
    const relations = await ProductOptionGroup.find({ productId }).lean();
    const groupIds = relations.map((r) => r.groupId);
    const groups = await MenuOptionGroup.find({ _id: { $in: groupIds } }).lean();
    const groupsById = new Map(groups.map((g) => [String(g._id), g]));

    const requiredGroups = [];
    const optionalGroups = [];

    for (const rel of relations) {
      const groupDoc = groupsById.get(String(rel.groupId));
      if (!groupDoc) continue;
      
      const item = {
        relation: rel,
        group: groupDoc,
      };

      if (Number(rel.minSelections || 0) > 0) {
        requiredGroups.push(item);
      } else {
        optionalGroups.push(item);
      }
    }

    console.log(`\n-------------------------------------------------`);
    console.log(`REQUIRED GROUPS (minSelections > 0):`);
    console.log(`-------------------------------------------------`);
    if (requiredGroups.length === 0) {
      console.log(`  (none)`);
    } else {
      for (const item of requiredGroups) {
        console.log(`  - ${item.group.name?.en} (${item.group.key})`);
        console.log(`    groupId:       ${item.group._id}`);
        console.log(`    minSelections: ${item.relation.minSelections}`);
        console.log(`    maxSelections: ${item.relation.maxSelections !== null ? item.relation.maxSelections : "unlimited"}`);
      }
    }

    console.log(`\n-------------------------------------------------`);
    console.log(`OPTIONAL GROUPS (minSelections == 0):`);
    console.log(`-------------------------------------------------`);
    if (optionalGroups.length === 0) {
      console.log(`  (none)`);
    } else {
      for (const item of optionalGroups) {
        console.log(`  - ${item.group.name?.en} (${item.group.key})`);
        console.log(`    groupId:       ${item.group._id}`);
        console.log(`    minSelections: ${item.relation.minSelections}`);
        console.log(`    maxSelections: ${item.relation.maxSelections !== null ? item.relation.maxSelections : "unlimited"}`);
      }
    }

    // Print options details for each group
    const allGroupItems = [...requiredGroups, ...optionalGroups];
    for (const item of allGroupItems) {
      console.log(`\n=================================================`);
      console.log(`GROUP: ${item.group.name?.en} (${item.group.key})`);
      console.log(`Rules: Min=${item.relation.minSelections}, Max=${item.relation.maxSelections !== null ? item.relation.maxSelections : "unlimited"}`);
      console.log(`groupId: ${item.group._id}`);
      console.log(`-------------------------------------------------`);

      const optionRelations = await ProductGroupOption.find({
        productId,
        groupId: item.group._id,
      }).lean();

      const optionIds = optionRelations.map((r) => r.optionId);
      const options = await MenuOption.find({ _id: { $in: optionIds } }).lean();
      const optionsById = new Map(options.map((o) => [String(o._id), o]));

      if (optionRelations.length === 0) {
        console.log(`  (No options configured)`);
      } else {
        for (const optRel of optionRelations) {
          const optDoc = optionsById.get(String(optRel.optionId));
          if (!optDoc) {
            console.log(`  - [Incomplete config] optionId: ${optRel.optionId}`);
            continue;
          }
          console.log(`  - Option:  ${optDoc.name?.en || "(No EN)"} / ${optDoc.name?.ar || "(No AR)"}`);
          console.log(`    optionId:   ${optDoc._id}`);
          console.log(`    optionKey:  ${optDoc.key || "(none)"}`);
          console.log(`    extraPrice: ${optRel.extraPriceHalala ?? optDoc.extraPriceHalala ?? 0} Halala`);
          console.log(`    isPremium:  ${optDoc.isPremium || optDoc.isPremiumProtein || false}`);
        }
      }
    }

    console.log(`\n=================================================`);

  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from database.");
  }
}

main().catch((err) => {
  console.error("Fatal Error:", err);
  mongoose.disconnect();
});
