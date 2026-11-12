import { mealProteinChoices, mealSideChoices } from "./meal-builder-options";

const proteinByName = new Map(mealProteinChoices.map((item) => [item.name, item]));
const sideByName = new Map(mealSideChoices.map((item) => [item.name, item]));

/**
 * Sum ONLY the separately-priced reference servings printed in the
 * restaurant menu. Not an order, discount, subscription or bundle quote.
 * Each selected side represents one listed menu serving.
 */
export function calculateMealPreview(proteinName: string, sideNames: string[]) {
  const protein = proteinByName.get(proteinName);
  if (!protein) return null;
  if (sideNames.length > 2 || new Set(sideNames).size !== sideNames.length) return null;

  const sides = sideNames.map((name) => sideByName.get(name));
  if (sides.some((side) => !side)) return null;

  const parts = [protein, ...sides.filter((side): side is NonNullable<typeof side> => Boolean(side))];
  const totalCents = parts.reduce((sum, part) => sum + Math.round(part.price * 100), 0);
  const calories = parts.reduce((sum, part) => sum + part.calories, 0);
  return {
    protein,
    sides: sides.filter((side): side is NonNullable<typeof side> => Boolean(side)),
    totalPriceSar: totalCents / 100,
    totalCalories: calories,
    selections: parts.length,
  };
}
