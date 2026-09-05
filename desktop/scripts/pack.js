'use strict';

// Assembles desktop/vendor (frontend dist + backend source) and packs the
// main `aidbquery` npm tarball.
//
// Usage (from the repo root):
//   node desktop/scripts/pack.js
//   AIDB_SKIP_FRONTEND_BUILD=1 node desktop/scripts/pack.js   # frontend already built
//
// The Windows runtime tarball is built separately via scripts/build-runtime.ps1.

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const desktopDir = path.join(repoRoot, 'desktop');
const frontendDir = path.join(repoRoot, 'frontend');
const backendDir = path.join(repoRoot, 'backend');
const vendorDir = path.join(desktopDir, 'vendor');

function sh(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...opts,
  });
  if (res.status !== 0) {
    throw new Error(`命令失败: ${cmd} ${args.join(' ')}`);
  }
}

function rmRf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function main() {
  // 1. Frontend build (Electron mode: relative base './')
  if (!process.env.AIDB_SKIP_FRONTEND_BUILD) {
    console.log('[1/3] Building frontend (npm ci + vite build)...');
    sh('npm', ['ci', '--no-audit', '--no-fund'], { cwd: frontendDir });
    sh('npm', ['run', 'build'], {
      cwd: frontendDir,
      env: { ...process.env, VITE_ELECTRON_BUILD: 'true' },
    });
  } else {
    console.log('[1/3] Skipping frontend build (AIDB_SKIP_FRONTEND_BUILD)');
  }
  const frontendDist = path.join(frontendDir, 'dist');
  if (!fs.existsSync(path.join(frontendDist, 'index.html'))) {
    throw new Error('frontend/dist/index.html 不存在——请先构建前端');
  }

  // 2. Assemble vendor/
  console.log('[2/3] Assembling vendor/ ...');
  rmRf(vendorDir);
  fs.cpSync(path.join(backendDir, 'app'), path.join(vendorDir, 'backend', 'app'), { recursive: true });
  fs.cpSync(frontendDist, path.join(vendorDir, 'frontend-dist'), { recursive: true });
  if (!fs.existsSync(path.join(vendorDir, 'backend', 'app', 'main.py'))) {
    throw new Error('vendor/backend 组装失败');
  }

  // 3. npm pack
  console.log('[3/3] Packing aidbquery tarball...');
  sh('npm', ['pack'], { cwd: desktopDir });

  console.log('');
  console.log('完成。下一步（发布 Windows 运行时包）:');
  console.log('  powershell -ExecutionPolicy Bypass -File scripts/build-runtime.ps1');
}

try {
  main();
} catch (err) {
  console.error(`[ERROR] ${err.message}`);
  process.exit(1);
}
