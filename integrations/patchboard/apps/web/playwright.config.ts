import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

// Keep ports stable across Playwright workers; callers can override both to run in parallel.
const jazzPort = Number(process.env.PATCHBOARD_TEST_JAZZ_PORT ?? "43171");
const port = Number(process.env.PATCHBOARD_TEST_PORT ?? "44171");
const baseURL = process.env.PATCHBOARD_TEST_URL ?? `http://127.0.0.1:${port}`;
const dataPath =
  process.env.PATCHBOARD_TEST_DATA_PATH ?? join(tmpdir(), "patchboard-e2e-" + randomUUID());

export default defineConfig({
  testDir: "./browser",
  testMatch: "**/*.spec.ts",
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL, browserName: "chromium", trace: "retain-on-failure", video: "on" },
  webServer: process.env.PATCHBOARD_TEST_URL
    ? undefined
    : [
        {
          command: `PORT=${jazzPort} PATCHBOARD_WEB_PORT=${port} PATCHBOARD_DATA_PATH="${dataPath}" pnpm --filter @patchboard/server dev`,
          url: `http://127.0.0.1:${jazzPort}/health`,
          reuseExistingServer: false,
          timeout: 30000,
        },
        {
          command: `PATCHBOARD_JAZZ_PORT=${jazzPort} pnpm exec vite preview --host 127.0.0.1 --port ${port} --strictPort`,
          url: baseURL,
          reuseExistingServer: false,
          timeout: 30000,
        },
      ],
});
