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
// One website source of truth: restaurant menu, shared by /menu and the preview builder.
const restaurantSource = read("lib/restaurant-menu-data.ts");
const restaurantMatch = restaurantSource.match(/export const restaurantMenuItems:\s*RestaurantMenuItem\[\]\s*=\s*(\[[\s\S]*?\]);/);
if (!restaurantMatch) fail("Restaurant menu data not parseable");
const restaurant = JSON.parse(restaurantMatch[1]);
if (restaurant.length !== 37) fail("Expected 37 approved restaurant-menu items");

const proteinItems = restaurant.filter(row => row.category === "الدجاج" || row.category === "الأسماك واللحوم");
const sideItems = restaurant.filter(row => row.category === "الكارب");
if (proteinItems.length !== 19 || sideItems.length !== 9) fail("Expected 19 protein choices and 9 sides");
const chickenItems = proteinItems.filter(row => row.category === "الدجاج");
const beefItems = proteinItems.filter(row => row.category === "الأسماك واللحوم" && !row.name.startsWith("سمك"));
const fishItems = proteinItems.filter(row => row.category === "الأسماك واللحوم" && row.name.startsWith("سمك"));
if (chickenItems.length !== 15 || beefItems.length !== 2 || fishItems.length !== 2)
  fail("Builder protein category distribution changed");

const names = [...proteinItems, ...sideItems].map(row => row.name);
if (new Set(names).size !== 28) fail("Builder names must be unique");
if (names.some(name => name.includes("فاهيتا"))) fail("Deleted fajita appeared in builder");
const expectedNames = ["دجاج 65", "دجاج تكا", "دجاج بالملوخية", "دجاج زعتر", "سمك مشوي", "سمك كريمة", "رز أبيض بسمتي"];
for (const name of expectedNames) if (!names.includes(name)) fail("Missing current menu choice: " + name);
for (const row of restaurant) {
  if (typeof row.name !== "string" || !(row.price > 0) || !Number.isFinite(row.calories) || row.calories < 0)
    fail("Invalid restaurant menu item: " + row.id);
  if (typeof row.image !== "string" || !row.image.startsWith("/restaurant-menu/") ||
      !existsSync(resolve(root, "public", row.image.slice(1))))
    fail("Missing restaurant photo for " + row.name);
}

const builderOptionsSource = read("lib/meal-builder-options.ts");
if (!builderOptionsSource.includes('from "./restaurant-menu-data"') ||
    !builderOptionsSource.includes('export const mealProteinChoices: BuilderProteinChoice[] = restaurantMenuItems') ||
    !builderOptionsSource.includes('export const mealSideChoices: BuilderSideChoice[] = restaurantMenuItems'))
  fail("Builder must derive its choices directly from the canonical restaurant catalog");
const builderCalculator = read("lib/meal-builder-calculator.ts");
if (!builderCalculator.includes("Math.round(part.price * 100)") ||
    !builderCalculator.includes("sideNames.length > 2") ||
    !builderCalculator.includes("totalCalories: calories"))
  fail("Builder price/calorie arithmetic or maximum selection guard missing");

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
