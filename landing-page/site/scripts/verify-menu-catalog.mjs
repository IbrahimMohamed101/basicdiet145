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
// Customer-requested custom-meal preview: 16 proteins, 9 sides, never silent omissions.
const builderOptionsSource = read("lib/meal-builder-options.ts");
const parseBuilderArray = name => {
  const match = builderOptionsSource.match(new RegExp("export const " + name + " = (\\[[\\s\\S]*?\\]) as const;"));
  if (!match) fail("Builder options not parseable: " + name);
  return JSON.parse(match[1]);
};
const mealProteins = parseBuilderArray("mealProteinChoices");
const mealSides = parseBuilderArray("mealSideChoices");
const proteinGroups = parseBuilderArray("mealProteinGroups");
if (mealProteins.length !== 16 || mealSides.length !== 9 || proteinGroups.length !== 4)
  fail("Expected 16 proteins / 9 sides / 4 protein filter tabs");
const counts = mealProteins.reduce((count, item) => ({ ...count, [item.group]: (count[item.group] || 0) + 1 }), {});
if (counts.chicken !== 11 || counts.beef !== 3 || counts.fish !== 2)
  fail("Unexpected distribution of chicken, meat or fish choices");
const allNames = [...mealProteins, ...mealSides].map(item => item.name);
if (new Set(allNames).size !== 25) fail("Duplicate custom-meal choice");
const requiredNames = ["دجاج مشوي","دجاج كريمة","دجاج مشروم","دجاج مكسيكي","دجاج باربكيو","دجاج استربس","دجاج ملوخية","دجاج هاني مسترد","دجاج سبايسي","دجاج بالروزماري","دجاج شيش","لحم مشروم","لحم كفتة كباب","لحم مفروم","سمك مشوي","سمك كريمي","بطاطس مشوي","بطاطس مهروسة","بطاطا حلوة","خضار مشكل مشوي","رز مصري بالشعيرية","رز أبيض","رز صيني معجن","باستا بالكريمة","باستا بالصلصة الحمراء"];
if (allNames.some(x => !requiredNames.includes(x)) || requiredNames.some(x => !allNames.includes(x)))
  fail("Builder option is missing or was unexpectedly renamed");
const imageAllowlist = read("app/api/meal-image/route.ts");
for (const item of [...mealProteins, ...mealSides]) {
  if (item.image === null) continue; // explicit, labeled illustration fallback
  if (typeof item.image !== "string" || !item.image.startsWith("/"))
    fail("Unsafe builder photo source for " + item.name);
  if (item.image.startsWith("/menu-images/") && !existsSync(resolve(root,"public",item.image.slice(1))))
    fail("Builder photo file missing: " + item.name);
  if (item.image.startsWith("/api/meal-image?id=")) {
    const driveId = item.image.split("=")[1];
    if (!imageAllowlist.includes(JSON.stringify(driveId))) fail("Builder Drive image ID not allowlisted: " + item.name);
  }
}
const builderUI = read("components/MenuExperience.tsx");
if (!builderUI.includes("filteredProteinChoices.map") || !builderUI.includes("mealSideChoices.map"))
  fail("Builder UI does not render all configured choices");
if (!builderUI.includes("صورة توضيحية") || !builderUI.includes("proteinGroup"))
  fail("Illustrative-media disclosure or category filter missing");
for (const file of ["components/MenuExperience.tsx", "components/MenuCalories.tsx", "components/MealGallery.tsx", "components/PlanCalculator.tsx"]) {
  const source = read(file);
  if (source.includes('Intl.NumberFormat("ar-SA"') || /[٠-٩۰-۹]/.test(source)) fail("Arabic-digit formatter or literal in " + file);
}
console.log("Basic Diet menu QA: " + posIds.length + " POS items, " + photos.length + " photo assets, " +
 verifiedIds.length + " source descriptions, " + Object.keys(editorial).length +
 " labeled editorial descriptions, " + Object.keys(nutrition).length + " nutrition matches.");
