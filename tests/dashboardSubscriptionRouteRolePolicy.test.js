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

const readRoles = rolesFor("subscriptionReadAccess");
const writeRoles = rolesFor("subscriptionWriteAccess");

assert.deepStrictEqual(
  readRoles,
  ["admin", "cashier", "restaurant", "kitchen"],
  "read access must preserve kitchen visibility and restaurant/cashier access"
);
assert.deepStrictEqual(
  writeRoles,
  ["admin", "cashier", "restaurant"],
  "write access must exclude the read-only kitchen role"
);
assert(!writeRoles.includes("kitchen"));

routeUses("get", "/search", "subscriptionReadAccess");
routeUses("get", "/:id/addon-entitlements", "subscriptionReadAccess");
routeUses("get", "/:id/balances", "subscriptionReadAccess");
routeUses("get", "/:subscriptionId/manual-deductions", "subscriptionReadAccess");

routeUses("post", "/quote", "subscriptionWriteAccess");
routeUses("post", "/", "subscriptionWriteAccess");
routeUses(
  "post",
  "/:subscriptionId/manual-deduction",
  "subscriptionWriteAccess"
);

console.log("dashboard subscription route role policy passed");
