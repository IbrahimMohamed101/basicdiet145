#!/usr/bin/env node
/**
 * Migration script: one-time conversion of single-language content to {ar, en} objects.
 *
 * What it does:
 *   - Plan:            name (String) → name.en  (name.ar defaults to "")
 *   - Addon:           name (String) → name.en  (name.ar defaults to "")
 *   - Meal:            name (String) → name.en  (name.ar defaults to "")
 *   - SaladIngredient: name_en / name_ar flat fields → name.{en, ar}
 *
 * Safe to run multiple times (idempotent) — skips docs where name is already an object.
 *
 * Usage:
 *   node scripts/migrate-multilang-names.js
 *
 * Requires MONGO_URI in environment (or .env file).
 */

require("dotenv").config();
const mongoose = require("mongoose");

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
    console.error("ERROR: MONGO_URI not set in environment.");
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Minimal raw schema access — we work directly with the native driver so the
// migration is independent of any schema changes we made to the models.
// ---------------------------------------------------------------------------

async function migrate() {
    await mongoose.connect(MONGO_URI);
    const db = mongoose.connection.db;

    console.log("MongoDB connected. Starting migration...\n");

    // ── Plan ──────────────────────────────────────────────────────────────────
    {
        const col = db.collection("plans");
        const docs = await col.find({ name: { $type: "string" } }).toArray();
        console.log(`Plan: found ${docs.length} document(s) with plain-string name`);
        let updated = 0;
        for (const doc of docs) {
            await col.updateOne(
                { _id: doc._id },
                { $set: { name: { ar: "", en: doc.name } } }
            );
            updated++;
        }
        console.log(`Plan: migrated ${updated} document(s)\n`);
    }

    // ── Addon ─────────────────────────────────────────────────────────────────
    {
        const col = db.collection("addons");
        const docs = await col.find({ name: { $type: "string" } }).toArray();
        console.log(`Addon: found ${docs.length} document(s) with plain-string name`);
        let updated = 0;
        for (const doc of docs) {
            await col.updateOne(
                { _id: doc._id },
                { $set: { name: { ar: "", en: doc.name } } }
            );
            updated++;
        }
        console.log(`Addon: migrated ${updated} document(s)\n`);
    }

    // ── Meal ──────────────────────────────────────────────────────────────────
    {
        const col = db.collection("meals");
        const docs = await col.find({ name: { $type: "string" } }).toArray();
        console.log(`Meal: found ${docs.length} document(s) with plain-string name`);
        let updated = 0;
        for (const doc of docs) {
            await col.updateOne(
                { _id: doc._id },
                { $set: { name: { ar: "", en: doc.name } } }
            );
            updated++;
        }
        console.log(`Meal: migrated ${updated} document(s)\n`);
    }

    // ── SaladIngredient ───────────────────────────────────────────────────────
    // Old flat fields: name_en, name_ar  →  name: { en, ar }
    {
        const col = db.collection("saladingredients");
        // Find docs that still have the old flat fields (name is NOT already an object)
        const docs = await col
            .find({
                $or: [{ name_en: { $exists: true } }, { name_ar: { $exists: true } }],
                // Skip docs already using the new shape
                name: { $not: { $type: "object" } },
            })
            .toArray();
        console.log(`SaladIngredient: found ${docs.length} document(s) with flat name_en/name_ar fields`);
        let updated = 0;
        for (const doc of docs) {
            await col.updateOne(
                { _id: doc._id },
                {
                    $set: { name: { en: doc.name_en || "", ar: doc.name_ar || "" } },
                    $unset: { name_en: "", name_ar: "" },
                }
            );
            updated++;
        }
        console.log(`SaladIngredient: migrated ${updated} document(s)\n`);
    }

    console.log("Migration complete.");
    await mongoose.disconnect();
}

migrate().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
});
