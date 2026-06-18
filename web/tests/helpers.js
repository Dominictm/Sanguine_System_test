'use strict';
// Test server lifecycle and HTTP utilities.
// Starts server.js on TEST_PORT so integration tests don't touch the dev server.

const { spawn } = require('child_process');
const path      = require('path');

const TEST_PORT = 3099;
const BASE      = `http://localhost:${TEST_PORT}`;

let _proc = null;

/** Start server.js on TEST_PORT; resolves when the listen message appears. */
async function startServer() {
  return new Promise((resolve, reject) => {
    _proc = spawn(process.execPath, [path.join(__dirname, '../server.js')], {
      // AI_MOCK makes all generation deterministic & offline so happy-path tests
      // never contact a real provider. Guard tests still hit their 400/404 paths
      // (those return before any generation client is built).
      env:   { ...process.env, PORT: String(TEST_PORT), AI_MOCK: '1' },
      cwd:   path.join(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => reject(new Error('Server startup timeout (15s)')), 15_000);
    const onData = buf => {
      if (String(buf).includes(`localhost:${TEST_PORT}`)) {
        clearTimeout(timer);
        _proc.stdout.off('data', onData);
        resolve();
      }
    };
    _proc.stdout.on('data', onData);
    _proc.stderr.on('data', () => {}); // silence stderr noise from validation bg task
    _proc.on('exit', (code) => {
      if (code !== null && code !== 0) reject(new Error(`Server exited prematurely (code ${code})`));
    });
    _proc.on('error', reject);
  });
}

/** Kill the test server. */
async function stopServer() {
  if (!_proc) return;
  _proc.kill();
  await new Promise(r => _proc.once('exit', r));
  _proc = null;
}

/**
 * Fetch a JSON API endpoint on the test server.
 * Returns { status: number, body: any }.
 */
async function apiJson(urlPath, opts = {}) {
  const res = await fetch(BASE + urlPath, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

module.exports = { startServer, stopServer, apiJson, BASE, TEST_PORT };
