import { defineConfig, devices } from "@playwright/test";

// The whole stack (sandbox node, contract, keeper, two web servers) is started
// by e2e/global-setup.ts, because each part needs values from the one before.
export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: "list",
  use: { ...devices["Desktop Chrome"], viewport: { width: 1360, height: 900 } },
});
