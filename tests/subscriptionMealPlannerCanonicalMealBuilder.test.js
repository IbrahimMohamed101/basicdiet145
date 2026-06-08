process.env.NODE_ENV = "test";

const { spawnSync } = require("child_process");
const path = require("path");

const testPath = path.join(__dirname, "subscriptionPlannerStaleCatalog.test.js");
const result = spawnSync(process.execPath, [testPath], {
  cwd: path.join(__dirname, ".."),
  env: { ...process.env, NODE_ENV: "test" },
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status || 0);
