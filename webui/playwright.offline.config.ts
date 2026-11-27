import { defineConfig } from "@playwright/test"
import base from "./playwright.config"


// The normal E2E config serves Vite dev, where the service worker is disabled.
process.env.DIM0_TEST_PROD_OFFLINE = "1"

export default defineConfig({
  ...base,
  testMatch: "offline.spec.ts",
  timeout: 60_000,
  use: { ...base.use, baseURL: "http://localhost:4335" },
  webServer: {
    command: "npm run preview -- --port 4335 --strictPort",
    url: "http://localhost:4335",
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
