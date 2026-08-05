const { app, BrowserWindow, session, Menu } = require('electron');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

let backendProcess = null;
let backendLogStream = null;
let frontendLogStream = null;
let backendStopped = false;

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function getResourcePath(...segments) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, ...segments);
  }
  return path.join(__dirname, '..', ...segments);
}

function getBackendExePath() {
  return getResourcePath('aiquery-backend.exe');
}

function getDataDir() {
  // Runtime data (config.db, logs) lives in the OS user-data directory so
  // credentials are never written into - or shipped with - the install tree.
  return path.join(app.getPath('userData'), 'data');
}

function getLogsDir() {
  const dir = path.join(getDataDir(), 'logs');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// ---------------------------------------------------------------------------
// File logging (overwrite on each startup)
// ---------------------------------------------------------------------------

function initLogs() {
  const logsDir = getLogsDir();
  const backendLogPath = path.join(logsDir, 'backend.log');
  const frontendLogPath = path.join(logsDir, 'frontend.log');

  // Overwrite log files on startup
  backendLogStream = fs.createWriteStream(backendLogPath, { flags: 'w' });
  frontendLogStream = fs.createWriteStream(frontendLogPath, { flags: 'w' });

  const now = new Date().toISOString();
  const header = `=== AI DB Query started at ${now} ===\n`;
  backendLogStream.write(header);
  frontendLogStream.write(header);
}

function writeLog(stream, prefix, message) {
  if (stream && stream.writable) {
    const ts = new Date().toISOString();
    stream.write(`[${ts}] [${prefix}] ${message}\n`);
  }
}

// ---------------------------------------------------------------------------
// Backend process management
// ---------------------------------------------------------------------------

function startBackend() {
  const exePath = getBackendExePath();
  const dataDir = getDataDir();

  writeLog(backendLogStream, 'electron', `Starting backend: ${exePath}`);
  writeLog(backendLogStream, 'electron', `DATA_DIR: ${dataDir}`);

  backendProcess = spawn(exePath, [], {
    env: { ...process.env, DATA_DIR: dataDir },
    windowsHide: true,
  });

  backendProcess.stdout.on('data', (data) => {
    const text = data.toString().trim();
    writeLog(backendLogStream, 'backend', text);
  });
  backendProcess.stderr.on('data', (data) => {
    const text = data.toString().trim();
    writeLog(backendLogStream, 'backend/err', text);
  });
  backendProcess.on('error', (err) => {
    writeLog(backendLogStream, 'electron', `Failed to start backend: ${err.message}`);
  });
  backendProcess.on('exit', (code) => {
    writeLog(backendLogStream, 'electron', `Backend exited with code ${code}`);
  });
}

function waitForBackend(maxRetries = 30) {
  return new Promise((resolve) => {
    let attempts = 0;
    const check = () => {
      const req = http.get('http://localhost:8000/health', (res) => {
        res.resume();
        if (res.statusCode === 200) {
          writeLog(backendLogStream, 'electron', 'Backend is ready');
          resolve();
        } else {
          retry();
        }
      });
      req.on('error', retry);
      req.setTimeout(1000, () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (++attempts >= maxRetries) {
        writeLog(backendLogStream, 'electron', 'Backend did not become ready in time');
        resolve();
      } else {
        setTimeout(check, 500);
      }
    };
    check();
  });
}

function stopBackend() {
  if (backendStopped) return;
  if (backendProcess && !backendProcess.killed) {
    backendStopped = true;
    writeLog(backendLogStream, 'electron', 'Stopping backend...');
    try {
      // Use taskkill /F /T on Windows to kill the entire process tree
      // (PyInstaller exe spawns uvicorn workers; SIGTERM alone may not suffice)
      if (process.platform === 'win32') {
        execSync(`taskkill /F /T /PID ${backendProcess.pid}`, { stdio: 'ignore' });
      } else {
        backendProcess.kill('SIGTERM');
      }
      writeLog(backendLogStream, 'electron', 'Backend process terminated');
    } catch (e) {
      writeLog(backendLogStream, 'electron', `Backend stop: ${e.message}`);
    }
  } else {
    backendStopped = true;
  }
}

// ---------------------------------------------------------------------------
// CORS handling
// ---------------------------------------------------------------------------

function setupCORS() {
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    if (details.url.includes('/api/')) {
      details.requestHeaders['Origin'] = 'http://localhost:5173';
    }
    callback({ requestHeaders: details.requestHeaders });
  });
}

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'AI DB Query',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Capture frontend console messages to log file
  win.webContents.on('console-message', (_event, level, message) => {
    const levelNames = ['verbose', 'info', 'warning', 'error'];
    const levelName = levelNames[level] || 'log';
    writeLog(frontendLogStream, `renderer/${levelName}`, message);
  });

  // Remove default menu bar
  Menu.setApplicationMenu(null);

  setupCORS();

  const indexPath = path.join(__dirname, 'dist', 'index.html');
  win.loadFile(indexPath);

  if (!app.isPackaged) {
    win.webContents.openDevTools();
  }

  return win;
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  initLogs();
  startBackend();
  await waitForBackend();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopBackend();
  // Close log streams
  if (backendLogStream) backendLogStream.end();
  if (frontendLogStream) frontendLogStream.end();
  app.quit();
});

app.on('before-quit', () => {
  stopBackend();
});
