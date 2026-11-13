import { defineConfig } from "@playwright/test";

const inCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./tests",
  timeout: 45_000,
  fullyParallel: false,
  retries: inCI ? 1 : 0,
  use: {
    baseURL: "http://127.0.0.1:3000",
    browserName: "chromium",
    locale: "ar-SA",
    screenshot: "only-on-failure",
    trace: inCI ? "on-first-retry" : "off",
  },
  reporter: inCI
    ? [
        ["line"],
        ["github"],
        ["html", { open: "never", outputFolder: "artifacts/playwright-report" }],
        ["json", { outputFile: "artifacts/playwright-results.json" }],
      ]
    : [["line"]],
});
