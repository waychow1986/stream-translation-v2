import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "test-results",
  reporter: [["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    browserName: "chromium",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
});
