# Menu Experience — Preview / approval gate

Route: `/menu`
Source: `landing-page/site` on Railway's tracked `landing-page-research` branch.
Implementation branch: `codex/menu-experience-preview-20261026`. This is not the deployed branch.

## Preview-only safeguards
- Route metadata sets `noindex, nofollow`? Current value is `index:false, follow:false`.
- The menu explorers have no checkout, payment, cart persistence, or mutation endpoint. The existing shared header's contact CTA still opens the existing `LeadDialog` and can submit a lead if the visitor explicitly chooses to; this is not a menu order.
- Subscription prices are **bootstrap demo values**, not production-authorized prices.
- Menu preview shows a limited sample of cashier candidates with original POS identifiers and prices; official sign-off on images, nutrition, descriptions, availability and item mapping is still needed.
- Steak is intentionally excluded; no guessed nutrition values or allergen statements.
- No Drive file IDs added to the image proxy. Reuses only image IDs already allowlisted in the site's existing public gallery.

## Before merging to a live branch
1. Approve the 108 candidate rows in `Basic_Diet_Landing_Menu_Master_2026-10-26.xlsx` (currently 0 approved). Resolve matching by cashier/POS ID, not repeated SKU, approve availability/images/descriptions/calories.
2. Fetch subscription prices from an authorized live catalog endpoint, verify 7/26/30 day plans, 100/150/200g, 1–5 meals/day, with offer and delivery/add-ons handled separately. Remove demo price matrix.
3. Replace limited sample catalog with approved full dataset from a sanitized allowlisted source (not raw Drive share URLs). Keep draft items hidden.
4. Connect one-time builder options to the published `GET /api/orders/menu` contract with min/max rules, pricing and visibility. Keep this route in display-only mode.
5. QA: `npm run typecheck`, `npm run build`, keyboard/tab order, 320/360/390/768/1440 widths, slow network, reduced-motion, broken images, RTL numbers, no horizontal overflow, source snapshots and all navigation links.
6. Decide whether to make `/menu` indexable and include it in `sitemap.ts` after the content gate closes.

## Interaction contract
- Mobile-first menu page with branded hero, sticky section links, animated price selector, meal/salad exploration, category filtering, accessible detail dialog and store CTAs.
- The price selector has illustrative seed values only. It is clearly labeled as a preview and has no payment action.
- The builders are interactive illustrations, not orders and have no pricing guarantees.

No Railway configuration was changed and no deployment is requested as part of this PR.

## Image source coverage (27 Oct 2026; preview only)
- 108 POS-price/name/category checked against cashier Master.
- 24 preview pictures sourced from exact-name, exact-price, exact-category matching against the app menu export (Cloudinary).
- 47 preview pictures use cashier-master name-based candidate links through the allowlisted server-side Drive image proxy (33 unique added Drive IDs).
- 37 remain without any safe one-to-one image mapping. Do not assign generic dish images by similarity.
- Images and all nutrition text remain unapproved; never deploy to the canonical domain solely due to visual coverage.
- Missing/broken source photos render the neutral Basic Diet placeholder with onError.
