#!/usr/bin/env node

/**
 * Clear All Catalog Data Script
 * 
 * Removes all documents from ALL catalog-related collections:
 * - One-time Menu: MenuCategory, MenuProduct, MenuOptionGroup, MenuOption, ProductOptionGroup, ProductGroupOption
 * - Meal Planner: BuilderCategory, BuilderProtein, BuilderCarb
 * - Common: Addon, Meal, MealCategory, MealIngredient
 * - Plans: Plan
 * 
 * Safety:
 * - If NODE_ENV=production, requires MENU_CLEAR_ALLOW_PRODUCTION=true
 */

require('dotenv').config();
const mongoose = require('mongoose');

// One-time Menu Models
const MenuCategory = require('../src/models/MenuCategory');
const MenuProduct = require('../src/models/MenuProduct');
const MenuOptionGroup = require('../src/models/MenuOptionGroup');
const MenuOption = require('../src/models/MenuOption');
const ProductOptionGroup = require('../src/models/ProductOptionGroup');
const ProductGroupOption = require('../src/models/ProductGroupOption');

// Meal Planner / Builder Models
const BuilderCategory = require('../src/models/BuilderCategory');
const BuilderProtein = require('../src/models/BuilderProtein');
const BuilderCarb = require('../src/models/BuilderCarb');

// Catalog & Plans Models
const Addon = require('../src/models/Addon');
const Meal = require('../src/models/Meal');
const MealCategory = require('../src/models/MealCategory');
const MealIngredient = require('../src/models/MealIngredient');
const Plan = require('../src/models/Plan');

const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;

async function clearAllCatalogs() {
  const isProduction = process.env.NODE_ENV === 'production';
  const allowProduction = process.env.MENU_CLEAR_ALLOW_PRODUCTION === 'true';

  if (isProduction && !allowProduction) {
    console.error('\n❌ ERROR: Safety Guard Triggered');
    console.error('Cannot clear catalog in PRODUCTION without MENU_CLEAR_ALLOW_PRODUCTION=true\n');
    process.exit(1);
  }

  if (!mongoUri) {
    console.error('\n❌ ERROR: MONGO_URI or MONGODB_URI environment variable is required\n');
    process.exit(1);
  }

  try {
    console.log('\n==========================================');
    console.log('CLEAR ALL CATALOG DATA (COMPLETE WIPE)');
    console.log('Environment:', process.env.NODE_ENV || 'development');
    console.log('==========================================\n');

    console.log('Connecting to database...');
    await mongoose.connect(mongoUri);
    console.log('Connected successfully\n');

    const collections = [
      // One-time menu
      { name: 'MenuCategory', model: MenuCategory },
      { name: 'MenuProduct', model: MenuProduct },
      { name: 'MenuOptionGroup', model: MenuOptionGroup },
      { name: 'MenuOption', model: MenuOption },
      { name: 'ProductOptionGroup', model: ProductOptionGroup },
      { name: 'ProductGroupOption', model: ProductGroupOption },
      // Meal planner / Builder
      { name: 'BuilderCategory', model: BuilderCategory },
      { name: 'BuilderProtein', model: BuilderProtein },
      { name: 'BuilderCarb', model: BuilderCarb },
      // Common items
      { name: 'Addon', model: Addon },
      { name: 'Meal', model: Meal },
      { name: 'MealCategory', model: MealCategory },
      { name: 'MealIngredient', model: MealIngredient },
      // Plans
      { name: 'Plan', model: Plan }
    ];

    console.log('Clearing documents from all catalog collections...');
    for (const item of collections) {
      const result = await item.model.deleteMany({});
      console.log(`  - ${item.name.padEnd(20)}: Deleted ${result.deletedCount} documents`);
    }

    console.log('\n✅ All catalog data wiped successfully.');
    console.log('You can now safely re-run your seed scripts.');
    
    await mongoose.disconnect();
    console.log('Disconnected from database');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Clearing failed:', err.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
}

clearAllCatalogs();
