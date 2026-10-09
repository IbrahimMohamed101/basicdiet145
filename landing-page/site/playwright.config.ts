import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 45_000,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:3000",
    browserName: "chromium",
    locale: "ar-SA",
    screenshot: "only-on-failure",
  },
  reporter: [["line"]],
});
