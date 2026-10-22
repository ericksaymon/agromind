import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e", timeout: 120000, workers: 1, fullyParallel: false,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000",
    headless: true, viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce",
    actionTimeout: 15000,
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
    screenshot: "only-on-failure", trace: "retain-on-failure",
  },
  reporter: "list",
});
