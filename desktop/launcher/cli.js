'use strict';

// `adq` command line:
//   adq            start the desktop app (backend + Electron window)
//   adq --check    headless smoke test: start backend, poll /health, exit
//   adq doctor     environment diagnostics
//   adq stop       kill a lingering backend process (pid file based)

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const env = require('./env');
const backend = require('./backend');
const logsMod = require('./logs');
const runtimeMod = require('./runtime');

const OK = '[OK]  ';
const FAIL = '[FAIL]';
const INFO = '[..]  ';

function die(message) {
  console.error(`${FAIL} ${message}`);
  process.exit(1);
}

function vendorSanity() {
  const { backendDir, frontendDist } = runtimeMod.vendorDirs();
  const backendEntry = path.join(backendDir, 'app', 'main.py');
  const frontendEntry = path.join(frontendDist, 'index.html');
  if (!fs.existsSync(backendEntry)) {
    throw new Error(`后端源码缺失: ${backendEntry}（安装包不完整，请重装 npm 包）`);
  }
  if (!fs.existsSync(frontendEntry)) {
    throw new Error(`前端资源缺失: ${frontendEntry}（安装包不完整，请重装 npm 包）`);
  }
  return { backendDir, frontendDist };
}

// ---------------------------------------------------------------------------
// adq
// ---------------------------------------------------------------------------

function start() {
  const rt = runtimeMod.resolveRuntime(); // throws with a readable message
  vendorSanity();
  const mainPath = path.join(__dirname, 'electron-main.js');

  console.log(`${INFO} 正在启动 ${env.WINDOW_TITLE}…`);
  // windowsHide MUST stay false: Windows passes SW_HIDE in the child's
  // STARTUPINFO and Chromium applies it to the first BrowserWindow, leaving
  // the app running with an invisible window (electron#26472). electron.exe
  // is a GUI-subsystem binary, so no console window appears either way.
  const child = spawn(rt.electronExe, [mainPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();

  // Stay alive just long enough to catch an immediate crash (e.g. missing
  // DLL); after that the window is up and this console can go away.
  let exited = false;
  child.on('exit', () => { exited = true; });
  child.on('error', (err) => {
    die(`无法启动 Electron（${rt.electronExe}）: ${err.message}`);
  });

  setTimeout(() => {
    if (exited) {
      die(`窗口启动失败，请查看日志: ${env.logsDir()}，或运行 adq doctor 自检`);
    }
    console.log(`${OK} 已启动。日志: ${env.logsDir()}`);
    console.log('      关闭窗口即会自动停止后端；再次启动直接运行 adq。');
    process.exit(0);
  }, 3000);
}

// ---------------------------------------------------------------------------
// adq --check
// ---------------------------------------------------------------------------

async function check() {
  const rt = runtimeMod.resolveRuntime();
  const { backendDir } = vendorSanity();

  const port = await backend.pickPort();
  console.log(`${INFO} 启动后端 (port ${port})…`);

  const handle = backend.startBackend({
    pythonExe: rt.pythonExe,
    backendDir,
    sitePackages: rt.sitePackages,
    port,
    dataDir: env.dataDir(),
  });
  handle.proc.stdout.on('data', () => {});
  handle.proc.stderr.on('data', () => {});

  const ok = await backend.waitForBackend(port, {
    log: (msg) => console.log(`${INFO} ${msg}`),
  });

  if (!ok) {
    backend.stopBackend(handle);
    die(`后端健康检查未通过（http://127.0.0.1:${port}/health）。请查看日志: ${env.logsDir()}`);
  }

  console.log(`${OK} 后端健康检查通过: http://127.0.0.1:${port}/health`);
  backend.stopBackend(handle);
  console.log(`${OK} 冒烟测试通过`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// adq doctor
// ---------------------------------------------------------------------------

async function doctor() {
  let failures = 0;
  const report = (label, ok, detail) => {
    if (!ok) failures += 1;
    console.log(`${ok ? OK : FAIL} ${label}${detail ? ` — ${detail}` : ''}`);
  };

  // 1. Node version
  const major = parseInt(process.versions.node.split('.')[0], 10);
  report(`Node.js >= 18（当前 ${process.versions.node}）`, major >= 18);

  // 2. Runtime pieces
  try {
    const rt = runtimeMod.resolveRuntime();
    report('运行时解析', true, rt.runtimeDir);
    report('便携 Python', true, rt.pythonExe);
    report('Electron', true, rt.electronExe);
    report('site-packages', true, rt.sitePackages);
    report('site-packages/fastapi', fs.existsSync(path.join(rt.sitePackages, 'fastapi')));
    report('site-packages/uvicorn', fs.existsSync(path.join(rt.sitePackages, 'uvicorn')));
  } catch (err) {
    report('运行时解析', false, err.message);
  }

  // 3. Vendored app assets
  try {
    const { backendDir, frontendDist } = vendorSanity();
    report('后端源码 (vendor/backend)', true, backendDir);
    report('前端资源 (vendor/frontend-dist)', true, frontendDist);
  } catch (err) {
    report('应用资源', false, err.message);
  }

  // 4. Data dir writable
  try {
    fs.mkdirSync(env.dataDir(), { recursive: true });
    const probe = path.join(env.dataDir(), '.doctor-probe');
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    report(`数据目录可写: ${env.dataDir()}`, true);
  } catch (err) {
    report('数据目录可写', false, err.message);
  }

  // 5. Port 8000 status (informational)
  const free = await backend.isPortFree(env.DEFAULT_PORT);
  report(`默认端口 ${env.DEFAULT_PORT} ${free ? '空闲' : '被占用（启动时会自动顺延）'}`, true);

  // 6. Lingering backend
  if (fs.existsSync(env.pidFile())) {
    try {
      const pid = fs.readFileSync(env.pidFile(), 'utf8').trim();
      console.log(`${INFO} 发现残留后端进程 pid=${pid}，可用 adq stop 清理`);
    } catch (err) { // ignore
    }
  }

  console.log('');
  if (failures > 0) {
    console.log(`${FAIL} 自检未通过（${failures} 项）。`);
    process.exit(1);
  }
  console.log(`${OK} 自检全部通过。运行 adq 启动应用。`);
}

// ---------------------------------------------------------------------------
// adq stop
// ---------------------------------------------------------------------------

function killPid(pid, label) {
  try {
    if (process.platform === 'win32') {
      const { execSync } = require('child_process');
      execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
    } else {
      process.kill(parseInt(pid, 10), 'SIGTERM');
    }
    console.log(`${OK} 已停止${label} (pid ${pid})`);
  } catch (err) {
    console.log(`${INFO} ${label}进程 ${pid} 已不存在`);
  }
}

function stop() {
  const hadAny = fs.existsSync(env.electronPidFile()) || fs.existsSync(env.pidFile());
  if (!hadAny) {
    console.log(`${INFO} 没有正在运行的应用（未发现 pid 文件）`);
    return;
  }
  // Electron first: killing its tree also takes the backend child with it;
  // the backend pass below is just belt and braces for orphaned backends.
  if (fs.existsSync(env.electronPidFile())) {
    let epid = null;
    try {
      epid = fs.readFileSync(env.electronPidFile(), 'utf8').trim();
      killPid(epid, '应用');
    } catch (err) {
      console.log(`${INFO} 无法读取应用 pid 文件: ${err.message}`);
    }
    try { fs.unlinkSync(env.electronPidFile()); } catch (err) { // ignore
    }
  }
  if (fs.existsSync(env.pidFile())) {
    let pid = null;
    try {
      pid = fs.readFileSync(env.pidFile(), 'utf8').trim();
      killPid(pid, '后端');
    } catch (err) {
      die(`无法读取 pid 文件: ${err.message}`);
    }
    try { fs.unlinkSync(env.pidFile()); } catch (err) { // ignore
    }
  }
}

// ---------------------------------------------------------------------------
// entry
// ---------------------------------------------------------------------------

function help() {
  console.log(`
${env.WINDOW_TITLE} (aidbquery) — 用法:

  adq            启动桌面应用（后端 + 独立窗口）
  adq --check    无窗口冒烟测试：启动后端 -> /health -> 自动退出
  adq doctor     环境自检
  adq stop       停止应用与残留的后端进程

数据目录: ${env.dataRoot()}
日志目录: ${env.logsDir()}
`.trim());
}

function run(argv) {
  const cmd = argv[0] || 'start';
  switch (cmd) {
    case 'start':
    case '--start':
      return start();
    case '--check':
    case 'check':
      return check().catch((err) => die(err.message || String(err)));
    case 'doctor':
      return doctor().catch((err) => die(err.message || String(err)));
    case 'stop':
      return stop();
    case 'help':
    case '--help':
    case '-h':
      return help();
    default:
      console.error(`未知命令: ${cmd}`);
      help();
      process.exit(1);
  }
}

module.exports = { run };
