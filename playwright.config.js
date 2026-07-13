'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { defineConfig } = require('@playwright/test');

const port = Number(process.env.WEBCRAFT_E2E_PORT) || 4173;
const dataDir = path.join(os.tmpdir(), 'webcraft-playwright-' + process.pid);
process.env.WEBCRAFT_E2E_DATA_DIR = dataDir;

function installedBrowserChannel() {
  const requested = String(process.env.PLAYWRIGHT_CHANNEL || '').trim();
  if (requested) return requested === 'chromium' ? undefined : requested;
  if (process.platform !== 'win32') return undefined;
  const chrome = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  if (chrome.some(file => fs.existsSync(file))) return 'chrome';
  const edge = [
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  return edge.some(file => fs.existsSync(file)) ? 'msedge' : undefined;
}

const channel = installedBrowserChannel();

module.exports = defineConfig({
  testDir: './tests/browser',
  testMatch: '**/*.spec.js',
  globalSetup: require.resolve('./tests/browser/global-setup.js'),
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 120000,
  expect: { timeout: 15000 },
  reporter: [['list']],
  outputDir: 'test-results/browser',
  use: {
    baseURL: 'http://127.0.0.1:' + port,
    headless: true,
    viewport: { width: 1280, height: 720 },
    channel,
    launchOptions: {
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
