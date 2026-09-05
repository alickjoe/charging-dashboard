'use strict';

// Locates the runtime pieces (portable Python, pre-built site-packages,
// Electron binary) and the vendored app assets (backend source, frontend dist).
//
// Resolution order per component:
//   1. AIDB_* environment override (development against a repo checkout)
//   2. The platform runtime package `aidbquery-runtime-win32-x64`
//   3. Electron only: the `electron` devDependency binary (dev convenience)

const fs = require('fs');
const path = require('path');

const { RUNTIME_PACKAGE } = require('./env');

function vendorDirs() {
  const backendDir = process.env.AIDB_BACKEND_DIR
    || path.join(__dirname, '..', 'vendor', 'backend');
  const frontendDist = process.env.AIDB_FRONTEND_DIST
    || path.join(__dirname, '..', 'vendor', 'frontend-dist');
  return { backendDir, frontendDist };
}

function findRuntimeDir(hasComponentOverrides) {
  if (process.env.AIDB_RUNTIME) {
    return path.resolve(process.env.AIDB_RUNTIME);
  }
  // Dev mode with every component overridden: the platform runtime package
  // is not needed at all.
  if (hasComponentOverrides) {
    return '';
  }
  if (process.platform !== 'win32') {
    throw new Error(
      'aidbquery 桌面版运行时目前仅提供 Windows x64 版本。\n'
      + '开发环境请通过 AIDB_PYTHON / AIDB_ELECTRON / AIDB_SITE_PACKAGES '
      + '等环境变量指向本地组件。'
    );
  }
  const pkgJsonPath = require.resolve(`${RUNTIME_PACKAGE}/package.json`);
  return path.join(path.dirname(pkgJsonPath), 'runtime');
}

// Returns the path to the `electron` devDependency binary, or null.
function devElectronPath() {
  try {
    const p = require('electron');
    if (typeof p === 'string' && fs.existsSync(p)) return p;
  } catch (err) {
    // electron package not installed (normal for end users).
  }
  return null;
}

function resolveRuntime() {
  const hasComponentOverrides = Boolean(
    process.env.AIDB_PYTHON && process.env.AIDB_SITE_PACKAGES && process.env.AIDB_ELECTRON,
  );
  const runtimeDir = findRuntimeDir(hasComponentOverrides);
  const pythonExe = process.env.AIDB_PYTHON
    || path.join(runtimeDir, 'python', 'python.exe');
  const sitePackages = process.env.AIDB_SITE_PACKAGES
    || path.join(runtimeDir, 'site-packages');

  // Electron: explicit override > runtime package binary > devDependency.
  let electronExe = process.env.AIDB_ELECTRON
    || path.join(runtimeDir, 'electron', 'electron.exe');
  if (!fs.existsSync(electronExe)) {
    electronExe = devElectronPath() || electronExe; // keep original path for the error message
  }

  const missing = [];
  if (!pythonExe || !fs.existsSync(pythonExe)) missing.push(`python: ${pythonExe}`);
  if (!electronExe || !fs.existsSync(electronExe)) missing.push(`electron: ${electronExe}`);
  if (!sitePackages || !fs.existsSync(sitePackages)) missing.push(`site-packages: ${sitePackages}`);
  if (missing.length) {
    throw new Error(
      '运行时不完整或未安装，缺少以下组件：\n  ' + missing.join('\n  ')
      + '\n请重新执行: npm install -g aidbquery'
    );
  }

  return { runtimeDir, pythonExe, electronExe, sitePackages };
}

module.exports = { vendorDirs, findRuntimeDir, resolveRuntime, devElectronPath };
