import snapshot from "./menu-nutrition-data.json";

export type MenuNutrition = {
  calories: number;
  portionLabel: string;
  unifiedId: string;
};

// Explicit POS joins only. A missing portion is never zero or a scaled 100g value.
const nutritionByPosId: Record<string, MenuNutrition> = snapshot.items;

export function getMenuNutrition(posId: string): MenuNutrition | null {
  return nutritionByPosId[posId] ?? null;
}

export const MENU_CALORIES_NOTE = "السعرات الحرارية تقريبية للحصة الموضحة، وقد تختلف حسب التحضير والتخصيص.";
