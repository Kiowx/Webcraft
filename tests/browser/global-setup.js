'use strict';

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { spawn, spawnSync } = require('node:child_process');

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function removeTestData(target) {
  if (!target) return;
  const resolved = path.resolve(target);
  const tempRoot = path.resolve(os.tmpdir()) + path.sep;
  if (!resolved.startsWith(tempRoot) || !path.basename(resolved).startsWith('webcraft-playwright-')) return;
  fs.rmSync(resolved, { recursive: true, force: true });
}

function serverReady(url) {
  return new Promise(resolve => {
    const request = http.get(url, response => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });
    request.setTimeout(1000, () => { request.destroy(); resolve(false); });
    request.on('error', () => resolve(false));
  });
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), delay(3000)]);
  if (child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  } else {
    child.kill('SIGKILL');
  }
  if (child.exitCode === null) await Promise.race([once(child, 'exit'), delay(2000)]);
}

module.exports = async function globalSetup() {
  const root = path.resolve(__dirname, '..', '..');
  const port = Number(process.env.WEBCRAFT_E2E_PORT) || 4173;
  const dataDir = process.env.WEBCRAFT_E2E_DATA_DIR;
  let serverOutput = '';
  const child = spawn(process.execPath, ['server/server.js'], {
    cwd: root,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DATA_DIR: dataDir,
      ADMIN_PASSWORD: 'playwright-local-test',
      MAX_PLAYERS: '4',
    },
  });
  const capture = chunk => { serverOutput = (serverOutput + chunk.toString()).slice(-12000); };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);

  const url = 'http://127.0.0.1:' + port;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    if (await serverReady(url)) {
      return async () => {
        await stopServer(child);
        removeTestData(dataDir);
      };
    }
    await delay(100);
  }

  await stopServer(child);
  removeTestData(dataDir);
  throw new Error('WebCraft test server failed to start.\n' + serverOutput);
};
