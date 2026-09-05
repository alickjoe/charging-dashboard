'use strict';

// Shared constants and user-level paths for the aidbquery desktop launcher.
// Everything lives under the per-user %APPDATA% tree: no admin rights needed.

const os = require('os');
const path = require('path');

const APP_NAME = 'aidbquery';
const WINDOW_TITLE = 'AI DB Query';
const RUNTIME_PACKAGE = 'aidbquery-runtime-win32-x64';

// Backend port: prefer the historical 8000, scan upward when busy so the app
// can coexist with the Docker deployment (which binds 8000/5173 fixed).
const DEFAULT_PORT = 8000;
const PORT_SCAN_MIN = 8001;
const PORT_SCAN_MAX = 8099;

// Backend /health polling budget (first cold start imports the whole
// site-packages tree, so keep this generous).
const HEALTH_RETRIES = 90;
const HEALTH_DELAY_MS = 500;

function dataRoot() {
  if (process.env.AIDB_DATA_DIR) {
    return path.resolve(process.env.AIDB_DATA_DIR);
  }
  const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(base, APP_NAME);
}

function dataDir() {
  return path.join(dataRoot(), 'data');
}

function logsDir() {
  return path.join(dataRoot(), 'logs');
}

function pidFile() {
  return path.join(dataDir(), 'backend.pid');
}

module.exports = {
  APP_NAME,
  WINDOW_TITLE,
  RUNTIME_PACKAGE,
  DEFAULT_PORT,
  PORT_SCAN_MIN,
  PORT_SCAN_MAX,
  HEALTH_RETRIES,
  HEALTH_DELAY_MS,
  dataRoot,
  dataDir,
  logsDir,
  pidFile,
};
