import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "/tmp/youtube-comments-analyzer-playwright",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 12_000 },
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4175",
    channel: "chrome",
    trace: "retain-on-failure"
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
    { name: "mobile-420", use: { ...devices["Desktop Chrome"], viewport: { width: 420, height: 912 } } },
    { name: "dark-desktop", use: { viewport: { width: 1280, height: 800 }, colorScheme: "dark" } }
  ],
  webServer: [
    {
      command: "YOUTUBE_FIXTURE_FALLBACK=1 DATA_DIR=/tmp/youtube-comments-analyzer-e2e .venv/bin/python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8011",
      url: "http://127.0.0.1:8011/api/health",
      reuseExistingServer: true,
      timeout: 30_000
    },
    {
      command: "bun run dev:e2e",
      url: "http://127.0.0.1:4175",
      reuseExistingServer: true,
      timeout: 30_000
    }
  ]
});
