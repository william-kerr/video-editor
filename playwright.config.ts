import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/browser',
  timeout: 120000,
  expect: { timeout: 15000 },
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4173/video-editor/', viewport: { width: 1480, height: 960 }, acceptDownloads: true, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'npm run build && npx vite preview --host 0.0.0.0 --port 4173', port: 4173, reuseExistingServer: true, timeout: 30000 },
})
