# Meal Planner Dashboard backend contract

- Dashboard administration uses the stable draft/published lifecycle under `/api/dashboard/meal-builder`.
- The public customer contract is `meal_planner_menu.v3` under `data.builderCatalog`.
- Requesting v3 does not automatically compile or expose a v2 mirror.
- Direct Meal Planner products come from `MenuProduct` rows whose `itemType` is `cold_sandwich` or `full_meal_product`.
- The Dashboard direct-products picker supports up to 1000 results per page.
