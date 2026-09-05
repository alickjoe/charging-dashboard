'use strict';

// Electron main process for the npm desktop deployment.
// Adapted from the exe deployment's electron/main.js; the differences are:
//   - backend runs as portable Python + uvicorn (no aiquery-backend.exe)
//   - backend port is dynamic (8000, or the next free port)
//   - API base URL is handed to the renderer via preload
//   - data/logs live in %APPDATA%\aidbquery

const { app, BrowserWindow, Menu, dialog, session } = require('electron');
const fs = require('fs');
const path = require('path');

const env = require('./env');
const backend = require('./backend');
const logsMod = require('./logs');
const runtimeMod = require('./runtime');

let loggers = null;
let backendHandle = null;
let win = null;

// Keep Electron's own cache inside our per-user root instead of %APPDATA%\Electron.
app.setPath('userData', env.dataRoot());

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    loggers = logsMod.createLoggers(env.logsDir());
    loggers.frontend('electron', `=== ${env.WINDOW_TITLE} started at ${new Date().toISOString()} ===`);

    try {
      const rt = runtimeMod.resolveRuntime();
      const { backendDir } = runtimeMod.vendorDirs();
      if (!require('fs').existsSync(path.join(backendDir, 'app', 'main.py'))) {
        throw new Error(`后端源码缺失: ${backendDir}`);
      }

      const port = await backend.pickPort();
      loggers.backend('electron', `Starting backend: ${rt.pythonExe}`);
      loggers.backend('electron', `port=${port} DATA_DIR=${env.dataDir()}`);

      backendHandle = backend.startBackend({
        pythonExe: rt.pythonExe,
        backendDir,
        sitePackages: rt.sitePackages,
        port,
        dataDir: env.dataDir(),
      });
      backend.pipeBackendLogs(backendHandle.proc, (prefix, msg) => loggers.backend(prefix, msg));

      const ok = await backend.waitForBackend(port, {
        log: (msg) => loggers.backend('electron', msg),
      });
      if (!ok) {
        loggers.backend('electron', 'Backend did not become ready in time; opening window anyway');
      }

      // Handed to the renderer through preload (contextBridge).
      process.env.AIDB_API_BASE = `http://127.0.0.1:${port}/api/v1`;
      createWindow();
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      loggers.backend('electron', `Startup failed: ${message}`);
      dialog.showErrorBox(`${env.WINDOW_TITLE} 启动失败`, `${message}\n\n日志位置: ${env.logsDir()}`);
      app.quit();
    }
  });
}

// Reuse the exe deployment's CORS handling: the SPA is loaded via file://,
// so rewrite the Origin header of API requests to an origin the backend
// already allow-lists.
function setupCORS() {
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    if (details.url.includes('/api/')) {
      details.requestHeaders['Origin'] = 'http://localhost:5173';
    }
    callback({ requestHeaders: details.requestHeaders });
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: env.WINDOW_TITLE,
    // Belt and braces against the inherited SW_HIDE show command: start
    // hidden and show explicitly once the page is ready. The explicit
    // ShowWindow(SW_SHOW) overrides whatever the launcher's STARTUPINFO
    // asked for, and doubles as anti-white-flash on slow first loads.
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  win.once('ready-to-show', () => {
    win.show();
    win.focus();
  });

  win.webContents.on('console-message', (_event, level, message) => {
    const levelNames = ['verbose', 'info', 'warning', 'error'];
    const levelName = levelNames[level] || 'log';
    loggers.frontend(`renderer/${levelName}`, message);
  });

  Menu.setApplicationMenu(null);
  setupCORS();

  const { frontendDist } = runtimeMod.vendorDirs();
  win.loadFile(path.join(frontendDist, 'index.html'));

  win.on('closed', () => {
    win = null;
  });
  return win;
}

function stopAll() {
  if (backendHandle) {
    loggers.backend('electron', 'Stopping backend...');
    backend.stopBackend(backendHandle);
    backendHandle = null;
  }
  // Clear our pid file so `adq stop` / doctor see a clean state.
  try { fs.unlinkSync(env.electronPidFile()); } catch (err) { // ignore
  }
}

// Advertise our pid so `adq stop` can take down the whole app (window +
// backend) even when the window was closed uncleanly.
try {
  fs.writeFileSync(env.electronPidFile(), String(process.pid), 'utf8');
} catch (err) {
  // non-fatal: stop/doctor just lose the hint
}

app.on('window-all-closed', () => {
  stopAll();
  if (loggers) loggers.close();
  app.quit();
});

app.on('before-quit', () => {
  stopAll();
});
