# Website calorie source — 2026-10-28

The website displays the existing channel-unification values, without recalculation. The user requested parity with Keeta, HungerStation and the application after the production website rollout.

Source: `Basic_Diet_Calories_Unified_4_Channels(1).xlsx`, sheet `01 السعرات الموحدة`, column N (effective working calories). SHA-256: `a8453fc97c7b15390e182b9f1b11da05d73e7d8f8aba4902d7d8ad6f182da90c`. This is an approximate operational source, not laboratory or recipe certification. The UI labels values approximate. No macros or allergens were inferred.

Cross-check sources:
- `Basic_Diet_Keeta_HungerStation_Calories_Executed_2026-10-25.xlsx`, SHA-256 `783c621078fdad3860f819dfaf30c003457583255a513536d9d5c739ffbcff42`.
- `Basic_Diet_Landing_Menu_Master_2026-10-26.xlsx`, SHA-256 `476b646d0441946230056dca5a92351ff48812f12cfa81d6d66a6f56dc98655e` (POS IDs, categories, portion identity).
- Read-only production `/api/orders/menu` on 2026-10-28. It still has zero/missing nutrition for some items; those zeros do not overwrite the explicit unified working value. No application/backend nutrition data was changed.

## Identity and display

`landing-page/site/lib/menu-nutrition-data.json` records each POS ID, original name, unified reference ID/name, source row, calories and portion. The home gallery, menu cards and details use that same mapping. The website's POS prices, names, images and item IDs remain intact.

82 of 108 POS items have mapped values. Matching uses dish type/category and portion, not a bare name. Liver sandwich POS 202 uses W059 (350), while liver breakfast POS 214 uses W010 (315). Tuna sandwich POS 30 uses W054 (310), while tuna breakfast POS 208 uses W011 (260). POS 34 belongs to the cashier's 200g Greek-yogurt category and uses W087 (120), not the breakfast yogurt W017 (150). Small/large salad SKUs use their corresponding source sizes, including small Greek POS 173 and large Greek POS 180. The two egg sandwich SKUs 32/200 retain the same sandwich reference W060.

The 100g seafood values refer to the listed portion; they are not a per-100g nutrient density. Switching to an unmapped 150g/200g SKU clears the numeric calorie display. No proportional scaling, summing of builder choices or copying between sizes occurs. Explicit numeric zero for water/diet soda remains visible.

## Unmapped values

26 POS IDs remain explicitly unavailable rather than zero:
- 2/3: cashier ice creams specify 100g, whereas the source ice-cream serving does not establish a matching weight.
- 16/51/222/49/76: cookie/basbousa/dessert-balls/sourdough-egg/plain-burger recipe identity not established; do not copy from similarly named foods.
- 201/90: variable sandwich/salad combinations; no fixed calorie total is claimed.
- 35: 200g fruit salad differs from the source 150g serving.
- 8: protein drink remained unresolved in the prior execution record.
- 52/53: small drink SKUs have no independent serving match in the source.
- 39: boiled egg meal is not an egg sandwich.
- 83/84/86/87/88/89: seafood 150g/200g has no independent matching source value.
- 42/43/44/79/80/129: generic chicken/beef portions do not identify the particular recipe in the source.

## Verification and release

Tests cover all mapped POS names and finite values, distinct category joins, explicit zero versus unknown, cross-page parity, size-switch clearing, and responsive card/detail rendering at 320/390/1440px. The source workbook is read only; its cached N values are copied verbatim. Runtime release status and CI/deployment evidence are recorded in the associated pull request.
