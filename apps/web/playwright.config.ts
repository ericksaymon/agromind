import { defineConfig } from "@playwright/test";
import { setDefaultResultOrder } from "node:dns";
// Keep localhost on the project's IPv4 listener when other workspaces bind ::1.
setDefaultResultOrder("ipv4first");
export default defineConfig({
  testDir: "./e2e", timeout: 120000, workers: 1, fullyParallel: false,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000",
    headless: true, viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce",
    actionTimeout: 15000,
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ["--host-resolver-rules=MAP localhost 127.0.0.1"] },
    screenshot: "only-on-failure", trace: "retain-on-failure",
  },
  reporter: "list",
});
