const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

function normalizePath(value) {
  let normalized = value.replace(/\/+/g, "/");
  if (normalized.length > 1) {
    normalized = normalized.replace(/\/$/, "");
  }
  return normalized.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function collectMountedRouteFiles() {
  const indexSource = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "index.js"), "utf8");
  const requireMap = {};

  for (const match of indexSource.matchAll(/const\s+(\w+)\s*=\s*require\("\.\/(.+?)"\);/g)) {
    requireMap[match[1]] = match[2];
  }

  const mounts = [];
  for (const match of indexSource.matchAll(/router\.use\(\s*"([^"]+)"\s*,\s*(\w+)\s*\);/g)) {
    const mountPath = match[1];
    const routeModuleName = match[2];
    const routeFile = requireMap[routeModuleName];
    if (!routeFile) continue;
    mounts.push({
      mountPath,
      filePath: path.join(__dirname, "..", "src", "routes", `${routeFile}.js`),
    });
  }

  for (const match of indexSource.matchAll(/router\.(get|post|put|patch|delete)\(\s*"([^"]+)"\s*,/g)) {
    mounts.push({
      inline: true,
      method: match[1].toUpperCase(),
      routePath: match[2],
    });
  }

  return mounts;
}

function collectActualRoutes() {
  const actual = new Set();

  for (const mount of collectMountedRouteFiles()) {
    if (mount.inline) {
      actual.add(`${mount.method} ${normalizePath(`/api${mount.routePath}`)}`);
      continue;
    }

    const source = fs.readFileSync(mount.filePath, "utf8");
    for (const match of source.matchAll(/router\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g)) {
      const method = match[1].toUpperCase();
      const routePath = match[2];
      actual.add(`${method} ${normalizePath(`/api${mount.mountPath}${routePath}`)}`);
    }
  }

  actual.add("GET /");
  actual.add("GET /health");
  actual.add("GET /api-docs/swagger.yaml");
  actual.add("GET /subscriptions-api-docs/swagger.yaml");

  return [...actual]
    .filter((entry) => {
      const [, routePath] = entry.split(" ");
      return !routePath.startsWith("/api/dashboard/") || routePath.startsWith("/api/dashboard/auth/");
    })
    .sort();
}

function collectDocumentedRoutes() {
  const source = fs.readFileSync(path.join(__dirname, "..", "swagger.yaml"), "utf8");
  const doc = yaml.load(source);
  const documented = new Set();

  for (const [routePath, operations] of Object.entries(doc.paths || {})) {
    for (const [method] of Object.entries(operations || {})) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      documented.add(`${method.toUpperCase()} ${normalizePath(routePath)}`);
    }
  }

  return documented;
}

test("swagger.yaml covers every canonical runtime route", () => {
  const actualRoutes = collectActualRoutes();
  const documentedRoutes = collectDocumentedRoutes();

  const missing = actualRoutes.filter((entry) => !documentedRoutes.has(entry));

  assert.deepEqual(
    missing,
    [],
    `Missing routes in swagger.yaml:\n${missing.join("\n")}`
  );
});
