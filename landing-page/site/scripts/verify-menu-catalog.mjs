import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Run after extract-menu-photos.mjs. Intentionally read-only.
const root = process.cwd();
const read = path => readFileSync(resolve(root, path), "utf8");
const menu = read("lib/menu-preview-items.ts");
const editorialText = read("lib/menu-editorial-descriptions.ts");
const verifiedText = read("lib/menu-item-details.ts");
const nutrition = JSON.parse(read("lib/menu-nutrition-data.json")).items;

const posIds = [...menu.matchAll(/"id":\s*"(\d+)"\s*,\s*"name":\s*"([^"]+)"\s*,\s*"category":\s*"([^"]+)"/g)].map(x => x[1]);
const photos = [...menu.matchAll(/"image":\s*"\/menu-images\/pos_(\d+)\.webp"/g)].map(x => x[1]);
const verifiedIds = [...verifiedText.matchAll(/"(\d+)":\s*\{\s*description:/g)].map(x => x[1]);
const editorialSource = editorialText.slice(editorialText.indexOf("= ") + 2).trim().replace(/;$/, "");
const editorial = JSON.parse(editorialSource);
const fail = message => { throw new Error("Basic Diet menu QA: " + message); };
if (posIds.length !== 108 || new Set(posIds).size !== 108) fail("Expected 108 distinct POS IDs");
if (photos.length !== 36 || new Set(photos).size !== 36) fail("Expected 36 named photo mappings");
for (const id of photos) {
  if (!posIds.includes(id)) fail("Image has invalid POS ID " + id);
  if (!existsSync(resolve(root, "public", "menu-images", "pos_" + id + ".webp"))) fail("Image file missing: POS " + id);
}
for (const id of posIds) {
  if (!verifiedIds.includes(id) && !editorial[id]) fail("Missing POS description " + id);
  if (verifiedIds.includes(id) && editorial[id]) fail("Conflicting verified/editorial description for POS " + id);
}
if (posIds.length !== verifiedIds.length + Object.keys(editorial).length) fail("Description inventory mismatch");
for (const [id, row] of Object.entries(nutrition)) {
  if (!posIds.includes(id) || typeof row.calories !== "number" || !Number.isFinite(row.calories) || row.calories < 0) fail("Invalid nutrition record: " + id);
}
// Meal builder: every visible protein/carb option should resolve to a photo,
// not a generic generated icon. All number formatters must use Latin digits.
const builder = read("components/MenuExperience.tsx");
const photoByOption = new Map([
  ["بيض مسلوق", "/menu-images/pos_39.webp"],
  ["رز برياني", "/menu-images/builder_biryani_rice.webp"],
  ["كينوا", "/menu-images/builder_quinoa.webp"],
  ["بطاطا حلوة", "/menu-images/builder_sweet_potato.webp"],
]);
for (const [name, image] of photoByOption) {
  if (!builder.includes(JSON.stringify(name) + ": " + JSON.stringify(image))) fail("Builder photo mapping missing for " + name);
  if (!existsSync(resolve(root, "public", image.slice(1)))) fail("Missing builder photo file: " + image);
}
for (const file of ["components/MenuExperience.tsx", "components/MenuCalories.tsx", "components/MealGallery.tsx", "components/PlanCalculator.tsx"]) {
  const source = read(file);
  if (source.includes('Intl.NumberFormat("ar-SA"') || /[٠-٩۰-۹]/.test(source)) fail("Arabic-digit formatter or literal in " + file);
}
console.log("Basic Diet menu QA: " + posIds.length + " POS items, " + photos.length + " photo assets, " +
 verifiedIds.length + " source descriptions, " + Object.keys(editorial).length +
 " labeled editorial descriptions, " + Object.keys(nutrition).length + " nutrition matches.");
