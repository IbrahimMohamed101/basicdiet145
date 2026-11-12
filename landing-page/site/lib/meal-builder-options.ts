import { restaurantMenuItems } from "./restaurant-menu-data";

/**
 * Public website meal-builder PREVIEW options sourced from the same printed
 * restaurant menu used by /menu. This is NOT the live subscription/POS catalog.
 * Prices are for the separately listed servings, never a subscription quote.
 */
export const mealProteinGroups = [
  { key: "all", label: "الكل" },
  { key: "chicken", label: "الدجاج" },
  { key: "beef", label: "اللحم" },
  { key: "fish", label: "السمك" },
] as const;

export type BuilderProteinGroup = Exclude<(typeof mealProteinGroups)[number]["key"], "all">;

export interface BuilderProteinChoice {
  name: string;
  group: BuilderProteinGroup;
  image: string;
  price: number;
  calories: number;
  illustrative: boolean;
}

export interface BuilderSideChoice {
  name: string;
  image: string;
  price: number;
  calories: number;
  illustrative: boolean;
}

export const mealProteinChoices: BuilderProteinChoice[] = restaurantMenuItems
  .filter((item) => item.category === "الدجاج" || item.category === "الأسماك واللحوم")
  .map((item) => ({
    name: item.name,
    group: item.category === "الدجاج" ? "chicken"
      : item.name.startsWith("سمك") ? "fish" : "beef",
    image: item.image,
    price: item.price,
    calories: item.calories,
    illustrative: item.illustrative === true,
  }));

export const mealSideChoices: BuilderSideChoice[] = restaurantMenuItems
  .filter((item) => item.category === "الكارب")
  .map((item) => ({
    name: item.name,
    image: item.image,
    price: item.price,
    calories: item.calories,
    illustrative: item.illustrative === true,
  }));
