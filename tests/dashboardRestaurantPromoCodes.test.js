"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

function run() {
  const capabilities = read("src/routes/dashboardRestaurantCapabilities.js");
  const promoRoutes = read("src/routes/dashboardPromoCodes.js");

  assert(
    capabilities.includes('router.use("/promo-codes", dashboardPromoCodeRoutes)'),
    "restaurant capability router must mount promo code routes before broad admin routes"
  );
  assert(
    promoRoutes.includes('dashboardRoleMiddleware(["admin", "restaurant"])'),
    "promo code management must explicitly allow restaurant"
  );

  for (const expected of [
    'router.get("/",',
    'router.post("/validate",',
    'router.get("/:id",',
    'router.post("/",',
    'router.put("/:id",',
    'router.patch("/:id/toggle",',
    'router.delete("/:id",',
  ]) {
    assert(
      promoRoutes.includes(expected),
      `promo code route contract missing ${expected}`
    );
  }

  assert(
    !promoRoutes.includes('"kitchen"'),
    "legacy kitchen accounts must not receive promo code management"
  );
  assert(
    !promoRoutes.includes('"cashier"'),
    "cashier accounts must not receive promo code management"
  );

  console.log("dashboard restaurant promo code policy checks passed");
}

run();
