#!/usr/bin/env node

/**
 * Clean Premium Catalog Script
 * 
 * Removes/deactivates duplicate legacy premium proteins with premiumKey null
 * and backfills subscription.premiumBalance with premiumKey and canonical proteinId.
 * 
 * Requires: ALLOW_PREMIUM_CATALOG_CLEANUP=true
 * 
 * Usage:
 *   ALLOW_PREMIUM_CATALOG_CLEANUP=true node scripts/clean-premium-catalog.js
 */

require('dotenv').config();

const mongoose = require('mongoose');
const BuilderProtein = require('../src/models/BuilderProtein');
const Subscription = require('../src/models/Subscription');

const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!mongoUri) {
  console.error('\n❌ ERROR: MONGO_URI or MONGODB_URI environment variable is required\n');
  process.exit(1);
}

const CANONICAL_PREMIUM_KEYS = ['shrimp', 'beef_steak', 'salmon', 'custom_premium_salad'];

const PREMIUM_KEY_NAMES = {
  shrimp: ['جمبري', 'shrimp', 'gambari', 'جمبرى'],
  beef_steak: ['ستيك لحم', 'beef steak', 'steak', 'لحم'],
  salmon: ['سالمون', 'salmon', 'سمك سالمون', 'سلمون'],
};

function normalizeName(value) {
  if (!value || typeof value !== 'string') return '';
  return value.toLowerCase().trim().replace(/\s+/g, ' ');
}

function generatePremiumKeyFromName(name) {
  if (!name) return null;
  const normalized = normalizeName(name);

  for (const [key, aliases] of Object.entries(PREMIUM_KEY_NAMES)) {
    for (const alias of aliases) {
      if (normalized.includes(alias)) return key;
    }
  }

  if (normalized.includes('جمبرى') || normalized.includes('shrimp') || normalized.includes('gambari')) {
    return 'shrimp';
  }
  if (normalized.includes('ستيك') || normalized.includes('steak') || normalized.includes('beef steak')) {
    return 'beef_steak';
  }
  if (normalized.includes('سالمون') || normalized.includes('salmon')) {
    return 'salmon';
  }

  return null;
}

async function findDuplicatePremiumProteins() {
  const allPremium = await BuilderProtein.find({ isPremium: true }).lean();

  const byKey = new Map();
  const byNormalizedName = new Map();

  for (const protein of allPremium) {
    const key = protein.premiumKey;
    const name = protein.name?.en || protein.name?.ar || '';
    const normalizedName = normalizeName(name);

    if (key) {
      if (!byKey.has(key)) {
        byKey.set(key, []);
      }
      byKey.get(key).push(protein);
    }

    if (normalizedName) {
      if (!byNormalizedName.has(normalizedName)) {
        byNormalizedName.set(normalizedName, []);
      }
      byNormalizedName.get(normalizedName).push(protein);
    }
  }

  return { allPremium, byKey, byNormalizedName };
}

async function cleanDuplicatePremiumProteins() {
  console.log('\n=== Step 1: Clean Duplicate Premium Proteins ===\n');

  const { allPremium, byKey, byNormalizedName } = await findDuplicatePremiumProteins();

  console.log(`Found ${allPremium.length} premium proteins in catalog`);

  const legacyDuplicates = [];
  const canonicalByKey = {};

  for (const protein of allPremium) {
    const key = protein.premiumKey;
    const name = protein.name?.en || protein.name?.ar || '';
    const normalizedName = normalizeName(name);

    if (!key) {
      if (CANONICAL_PREMIUM_KEYS.includes(normalizedName.replace(' ', '_'))) {
        legacyDuplicates.push({
          protein,
          reason: 'premiumKey null but name matches canonical',
        });
      } else if (normalizedName.includes('جمبرى') || normalizedName.includes('shrimp') ||
               normalizedName.includes('gambari')) {
        legacyDuplicates.push({
          protein,
          reason: 'premiumKey null but name is shrimp variant',
        });
      } else if (normalizedName.includes('ستيك') || normalizedName.includes('steak') ||
               normalizedName.includes('beef steak')) {
        legacyDuplicates.push({
          protein,
          reason: 'premiumKey null but name is steak variant',
        });
      } else if (normalizedName.includes('سالمون') || normalizedName.includes('salmon')) {
        legacyDuplicates.push({
          protein,
          reason: 'premiumKey null but name is salmon variant',
        });
      }
    }

    if (key && CANONICAL_PREMIUM_KEYS.includes(key)) {
      canonicalByKey[key] = protein;
    }
  }

  console.log('\n--- Duplicate Legacy Premium Proteins (premiumKey null) ---');
  for (const dup of legacyDuplicates) {
    console.log(`  [DUPLICATE] ${dup.protein._id}: ${dup.protein.name?.en} (${dup.reason})`);
  }

  console.log('\n--- Canonical Premium Proteins ---');
  for (const [key, protein] of Object.entries(canonicalByKey)) {
    console.log(`  [CANONICAL] ${protein._id}: ${key} = ${protein.name?.en}`);
  }

  if (legacyDuplicates.length > 0) {
    console.log(`\nDeactivating ${legacyDuplicates.length} legacy duplicate premium proteins...`);

    for (const dup of legacyDuplicates) {
      await BuilderProtein.findByIdAndUpdate(dup.protein._id, {
        isActive: false,
        availableForSubscription: false,
      });
      console.log(`  [DEACTIVATED] ${dup.protein._id}`);
    }
  }

  console.log(`\nCleaned ${legacyDuplicates.length} duplicate premium proteins`);
  return legacyDuplicates.length;
}

async function ensureCanonicalProteinsExist() {
  console.log('\n=== Step 2: Ensure Canonical Premium Proteins Exist ===\n');

  const category = await BuilderProtein.findOne({ dimension: 'protein' });
  let displayCategoryId = category?._id;
  let displayCategoryKey = category?.key || 'protein_category';

  if (!displayCategoryId) {
    const BuilderCategory = require('../src/models/BuilderCategory');
    const newCategory = new BuilderCategory({
      key: 'protein_category',
      dimension: 'protein',
      name: { ar: 'بروتين', en: 'Protein' },
      description: { ar: 'مصادر البروتين', en: 'Protein sources' },
      isActive: true,
      sortOrder: 1,
    });
    await newCategory.save();
    displayCategoryId = newCategory._id;
    displayCategoryKey = newCategory.key;
  }

  const baseProtein = {
    displayCategoryId,
    displayCategoryKey,
    isActive: true,
    availableForSubscription: true,
  };

  const canonicalProteins = [
    {
      key: 'shrimp',
      name: { ar: 'جمبري', en: 'Shrimp' },
      description: { ar: 'جمبري مشوي', en: 'Grilled shrimp' },
      proteinFamilyKey: 'seafood',
      extraFeeHalala: 1500,
    },
    {
      key: 'beef_steak',
      name: { ar: 'ستيك لحم', en: 'Beef Steak' },
      description: { ar: 'ستيك لحم مشوي', en: 'Grilled beef steak' },
      proteinFamilyKey: 'beef',
      extraFeeHalala: 2000,
    },
    {
      key: 'salmon',
      name: { ar: 'سلمون', en: 'Salmon' },
      description: { ar: 'سلمون مشوي', en: 'Grilled salmon' },
      proteinFamilyKey: 'seafood',
      extraFeeHalala: 1800,
    },
  ];

  let created = 0;

  for (const canon of canonicalProteins) {
    const existing = await BuilderProtein.findOne({ premiumKey: canon.key, isPremium: true });

    if (existing) {
      console.log(`  [EXISTS] ${canon.key} = ${existing._id}`);
      continue;
    }

    const newProtein = new BuilderProtein({
      ...baseProtein,
      ...canon,
      name: canon.name,
      description: canon.description,
      proteinFamilyKey: canon.proteinFamilyKey,
      ruleTags: ['premium'],
      isPremium: true,
      premiumKey: canon.key,
      extraFeeHalala: canon.extraFeeHalala,
      currency: 'SAR',
      sortOrder: CANONICAL_PREMIUM_KEYS.indexOf(canon.key),
    });

    await newProtein.save();
    console.log(`  [CREATED] ${canon.key} = ${newProtein._id}`);
    created++;
  }

  console.log(`\nEnsured ${created} canonical premium proteins exist`);
  return created;
}

async function backfillSubscriptionPremiumBalance() {
  console.log('\n=== Step 3: Backfill Subscription Premium Balance ===\n');

  const subscriptions = await Subscription.find({
    premiumBalance: { $exists: true, $ne: [] },
  }).lean();

  console.log(`Found ${subscriptions.length} subscriptions with premiumBalance`);

  const canonicalByKey = {};
  const canonicalByName = {};

  for (const key of CANONICAL_PREMIUM_KEYS) {
    const protein = await BuilderProtein.findOne({ premiumKey: key, isPremium: true, isActive: true });
    if (protein) {
      canonicalByKey[key] = protein;
      const name = protein.name?.en || protein.name?.ar || '';
      const normalized = normalizeName(name);
      if (normalized) {
        canonicalByName[normalized] = protein;
      }
    }
  }

    if (PREMIUM_KEY_NAMES[key]) {
      for (const alias of PREMIUM_KEY_NAMES[key]) {
        canonicalByName[alias] = canonicalByKey[key];
      }
    }
  }

  console.log('\n--- Canonical Protein Map ---');
  for (const [key, protein] of Object.entries(canonicalByKey)) {
    console.log(`  ${key} = ${protein._id}`);
  }

  let totalUpdated = 0;
  let subscriptionsUpdated = 0;

  for (const sub of subscriptions) {
    const balance = sub.premiumBalance || [];
    const updates = [];

    for (let i = 0; i < balance.length; i++) {
      const row = balance[i];
      if (!row || !row.proteinId) continue;

      const proteinIdStr = String(row.proteinId);

      if (row.premiumKey && CANONICAL_PREMIUM_KEYS.includes(row.premiumKey)) {
        continue;
      }

      let canonicalKey = null;
      let canonicalProteinId = proteinIdStr;

      if (row.premiumKey) {
        const generated = generatePremiumKeyFromName(row.premiumKey);
        if (generated && CANONICAL_PREMIUM_KEYS.includes(generated)) {
          canonicalKey = generated;
        }
      }

      if (!canonicalKey) {
        for (const [name, protein] of Object.entries(canonicalByName)) {
          if (String(protein._id) === proteinIdStr) {
            canonicalKey = protein.premiumKey;
            break;
          }
        }
      }

      if (!canonicalKey) {
        const generated = generatePremiumKeyFromName(row.name || '');
        if (generated && CANONICAL_PREMIUM_KEYS.includes(generated)) {
          canonicalKey = generated;
        }
      }

      if (!canonicalKey) {
        const proteinDoc = await BuilderProtein.findById(proteinIdStr).lean();
        if (proteinDoc) {
          if (proteinDoc.premiumKey && CANONICAL_PREMIUM_KEYS.includes(proteinDoc.premiumKey)) {
            canonicalKey = proteinDoc.premiumKey;
          } else if (proteinDoc.name) {
            const generated = generatePremiumKeyFromName(
              proteinDoc.name.en || proteinDoc.name.ar || ''
            );
            if (generated && CANONICAL_PREMIUM_KEYS.includes(generated)) {
              canonicalKey = generated;
            }
          }
        }
      }

      if (canonicalKey && canonicalByKey[canonicalKey]) {
        updates.push({
          index: i,
          premiumKey: canonicalKey,
          proteinId: canonicalByKey[canonicalKey]._id,
        });
      }
    }

    if (updates.length > 0) {
      for (const upd of updates) {
        await Subscription.updateOne(
          { _id: sub._id, 'premiumBalance.proteinId': balance[upd.index].proteinId },
          {
            $set: {
              'premiumBalance.$.premiumKey': upd.premiumKey,
              'premiumBalance.$.proteinId': upd.proteinId,
            },
          }
        );
      }
      console.log(`  [UPDATED] subscription ${sub._id}: ${updates.length} rows`);
      subscriptionsUpdated++;
      totalUpdated += updates.length;
    }
  }

  console.log(`\nUpdated ${totalUpdated} premiumBalance rows across ${subscriptionsUpdated} subscriptions`);
  return { totalUpdated, subscriptionsUpdated };
}

async function backfillContractSnapshotPremiumSelections() {
  console.log('\n=== Step 4: Backfill Contract Snapshot Premium Selections ===\n');

  const subscriptions = await Subscription.find({
    contractSnapshot: { $exists: true, $ne: null },
    $or: [
      { 'contractSnapshot.premiumSelections.premiumKey': { $exists: false } },
      { 'contractSnapshot.premiumSelections.premiumKey': null },
      { 'contractSnapshot.entitlementContract.premiumItems.premiumKey': { $exists: false } },
      { 'contractSnapshot.entitlementContract.premiumItems.premiumKey': null },
    ],
  }).lean();

  console.log(`Found ${subscriptions.length} subscriptions with contract snapshots needing premiumKey backfill`);

  let totalUpdated = 0;

  for (const sub of subscriptions) {
    const snapshot = sub.contractSnapshot || {};
    const premiumSelections = snapshot.premiumSelections || [];
    const entitlementContract = snapshot.entitlementContract || {};
    const entitlementPremiumItems = entitlementContract.premiumItems || [];

    let needsUpdate = false;
    const newPremiumSelections = [];
    const newEntitlementPremiumItems = [];

    for (const item of premiumSelections) {
      if (!item.premiumKey && item.proteinId) {
        const resolved = await generatePremiumKeyFromProteinId(item.proteinId);
        if (resolved) {
          needsUpdate = true;
          newPremiumSelections.push({
            ...item,
            premiumKey: resolved.premiumKey,
            proteinId: resolved.canonicalProteinId,
          });
        } else {
          newPremiumSelections.push(item);
        }
      } else {
        newPremiumSelections.push(item);
      }
    }

    for (const item of entitlementPremiumItems) {
      if (!item.premiumKey && item.proteinId) {
        const resolved = await generatePremiumKeyFromProteinId(item.proteinId);
        if (resolved) {
          needsUpdate = true;
          newEntitlementPremiumItems.push({
            ...item,
            premiumKey: resolved.premiumKey,
            proteinId: resolved.canonicalProteinId,
          });
        } else {
          newEntitlementPremiumItems.push(item);
        }
      } else {
        newEntitlementPremiumItems.push(item);
      }
    }

    if (needsUpdate) {
      await Subscription.updateOne(
        { _id: sub._id },
        {
          $set: {
            'contractSnapshot.premiumSelections': newPremiumSelections,
            'contractSnapshot.entitlementContract.premiumItems': newEntitlementPremiumItems,
          },
        }
      );
      console.log(`  [UPDATED] subscription ${sub._id}: contractSnapshot premiumKey backfilled`);
      totalUpdated++;
    }
  }

  console.log(`\nUpdated contract snapshots for ${totalUpdated} subscriptions`);
  return totalUpdated;
}

async function generatePremiumKeyFromProteinId(proteinId) {
  if (!proteinId) return null;

  const proteinDoc = await BuilderProtein.findById(proteinId).lean();
  if (!proteinDoc) return null;

  if (proteinDoc.premiumKey && CANONICAL_PREMIUM_KEYS.includes(proteinDoc.premiumKey)) {
    const canonical = await BuilderProtein.findOne({
      premiumKey: proteinDoc.premiumKey,
      isPremium: true,
      isActive: true,
    }).lean();
    return {
      premiumKey: proteinDoc.premiumKey,
      canonicalProteinId: canonical?._id || proteinId,
    };
  }

  const inferredKey = generatePremiumKeyFromName(proteinDoc.name?.en || proteinDoc.name?.ar || '');
  if (inferredKey && CANONICAL_PREMIUM_KEYS.includes(inferredKey)) {
    const canonical = await BuilderProtein.findOne({
      premiumKey: inferredKey,
      isPremium: true,
      isActive: true,
    }).lean();
    return {
      premiumKey: inferredKey,
      canonicalProteinId: canonical?._id || proteinId,
    };
  }

  return null;
}

async function printSummary() {
  console.log('\n=== Summary ===\n');

  const activePremium = await BuilderProtein.find({
    isPremium: true,
    isActive: true,
    availableForSubscription: { $ne: false },
    premiumKey: { $ne: null },
  }).lean();

  console.log('Active canonical premium proteins:');
  for (const p of activePremium) {
    const key = p.premiumKey;
    const name = p.name?.en || p.name?.ar || '';
    console.log(`  ${key}: ${name} (${p._id})`);
  }

  const subsWithBalance = await Subscription.countDocuments({
    premiumBalance: { $exists: true, $ne: [] },
  });

  const subsWithPremiumKey = await Subscription.countDocuments({
    'premiumBalance.premiumKey': { $ne: null },
  });

  console.log(`\nSubscriptions with premiumBalance: ${subsWithBalance}`);
  console.log(`Subscriptions with premiumKey set: ${subsWithPremiumKey}`);

  const subsWithContractSnapshot = await Subscription.countDocuments({
    contractSnapshot: { $exists: true, $ne: null },
  });

  console.log(`Subscriptions with contractSnapshot: ${subsWithContractSnapshot}`);
}

async function main() {
  if (process.env.ALLOW_PREMIUM_CATALOG_CLEANUP !== 'true') {
    console.error('\n❌ ERROR: This script requires explicit environment flag');
    console.error('Please set ALLOW_PREMIUM_CATALOG_CLEANUP=true to run\n');
    console.error('Example:');
    console.error('  ALLOW_PREMIUM_CATALOG_CLEANUP=true npm run clean:premium-catalog\n');
    process.exit(1);
  }

  try {
    console.log('\n==========================================');
    console.log('CLEAN PREMIUM CATALOG');
    console.log('==========================================\n');

    console.log('Connecting to database...');
    await mongoose.connect(mongoUri);
    console.log('Connected to database');

    await cleanDuplicatePremiumProteins();
    await ensureCanonicalProteinsExist();
    await backfillSubscriptionPremiumBalance();
    await backfillContractSnapshotPremiumSelections();
    await printSummary();

    console.log('\n=== Cleanup Complete ===\n');
    await mongoose.disconnect();
    console.log('Disconnected from database');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Cleanup failed:', err.message);
    console.error(err.stack);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
}

main();