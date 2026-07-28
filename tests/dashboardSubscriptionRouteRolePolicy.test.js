"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const routePath = path.join(
  __dirname,
  "../src/routes/dashboardSubscriptions.js"
);
const source = fs.readFileSync(routePath, "utf8");

function rolesFor(constantName) {
  const pattern = new RegExp(
    `const\\s+${constantName}\\s*=\\s*dashboardRoleMiddleware\\(\\[([\\s\\S]*?)\\]\\);`
  );
  const match = source.match(pattern);
  assert(match, `${constantName} role declaration must exist`);
  return [...match[1].matchAll(/["']([^"']+)["']/g)].map((row) => row[1]);
}

function routeUses(method, route, middlewareName) {
  const escapedRoute = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `router\\.${method}\\(\\s*["']${escapedRoute}["'][\\s\\S]*?dashboardAuthMiddleware,\\s*${middlewareName},`
  );
  assert(
    pattern.test(source),
    `${method.toUpperCase()} ${route} must use ${middlewareName}`
  );
}

const staffRoles = rolesFor("subscriptionStaffAccess");
const deductionRoles = rolesFor("manualDeductionWriteAccess");

assert.deepStrictEqual(
  staffRoles,
  ["admin", "cashier", "restaurant", "kitchen"],
  "legacy kitchen must retain subscription search, quote, create, and read access"
);
assert.deepStrictEqual(
  deductionRoles,
  ["admin", "cashier", "restaurant"],
  "manual deduction writes must exclude kitchen"
);
assert(!deductionRoles.includes("kitchen"));

routeUses("get", "/search", "subscriptionStaffAccess");
routeUses("post", "/quote", "subscriptionStaffAccess");
routeUses("post", "/", "subscriptionStaffAccess");
routeUses("get", "/:id/addon-entitlements", "subscriptionStaffAccess");
routeUses("get", "/:id/balances", "subscriptionStaffAccess");
routeUses(
  "get",
  "/:subscriptionId/manual-deductions",
  "subscriptionStaffAccess"
);

routeUses(
  "post",
  "/:subscriptionId/manual-deduction",
  "manualDeductionWriteAccess"
);

console.log("dashboard subscription route role policy passed");
