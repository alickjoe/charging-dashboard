'use strict';

// Backend (FastAPI/uvicorn) process management shared by the CLI and the
// Electron main process. The backend is run as plain Python from the bundled
// runtime — no PyInstaller, no exe artifacts.

const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');

const { HEALTH_RETRIES, HEALTH_DELAY_MS, PORT_SCAN_MIN, PORT_SCAN_MAX, DEFAULT_PORT } = require('./env');

function isPortFree(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, host);
  });
}

// Prefer 8000 (same as the other deployment modes); when it is taken — e.g.
// by the Docker stack on the same machine — scan 8001..8099 for a free port.
async function pickPort() {
  if (await isPortFree(DEFAULT_PORT)) return DEFAULT_PORT;
  for (let p = PORT_SCAN_MIN; p <= PORT_SCAN_MAX; p++) {
    if (await isPortFree(p)) return p;
  }
  throw new Error(`端口 ${DEFAULT_PORT}-${PORT_SCAN_MAX} 均被占用，无法启动后端`);
}

function startBackend({ pythonExe, backendDir, sitePackages, port, dataDir }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const pidFile = path.join(dataDir, 'backend.pid');

  const env = {
    ...process.env,
    // site-packages resolved BEFORE the stdlib is fine: stdlib paths stay
    // ahead via the interpreter defaults; PYTHONPATH only adds ours.
    PYTHONPATH: sitePackages,
    DATA_DIR: dataDir,
    // Same origins as the stock backend default: the Electron main process
    // rewrites the request Origin header to http://localhost:5173.
    CORS_ORIGINS: 'http://localhost:5173,http://127.0.0.1:5173',
    PYTHONUNBUFFERED: '1',
    PYTHONDONTWRITEBYTECODE: '1',
  };

  // Bind to 127.0.0.1 only: no Windows Firewall prompt, not reachable from LAN.
  const proc = spawn(
    pythonExe,
    ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(port)],
    { cwd: backendDir, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );

  fs.writeFileSync(pidFile, String(proc.pid), 'utf8');
  return { proc, pidFile, port };
}

function pipeBackendLogs(proc, writeLog) {
  const forward = (chunk, level) => {
    const text = chunk.toString().trim();
    if (text) text.split(/\r?\n/).forEach((line) => writeLog(level, line));
  };
  proc.stdout.on('data', (chunk) => forward(chunk, 'backend'));
  proc.stderr.on('data', (chunk) => forward(chunk, 'backend/err'));
  proc.on('error', (err) => writeLog('electron', `Failed to start backend: ${err.message}`));
  proc.on('exit', (code) => writeLog('electron', `Backend exited with code ${code}`));
}

function waitForBackend(port, { retries = HEALTH_RETRIES, delayMs = HEALTH_DELAY_MS, log = () => {} } = {}) {
  return new Promise((resolve) => {
    let attempts = 0;
    const attempt = () => {
      const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
        res.resume();
        if (res.statusCode === 200) {
          resolve(true);
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
      attempts += 1;
      if (attempts >= retries) {
        resolve(false);
      } else {
        if (attempts % 10 === 0) log(`waiting for backend (attempt ${attempts}/${retries})`);
        setTimeout(attempt, delayMs);
      }
    };
    attempt();
  });
}

// Kill the whole process tree. Plain `python -m uvicorn` runs as a single
// process, but taskkill /T is the proven belt-and-braces on Windows.
function stopBackend({ proc, pidFile }) {
  let pid = null;
  if (pidFile) {
    try {
      pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    } catch (err) {
      // no pid file — fall through to the child process handle
    }
  }
  if (!pid && proc && proc.pid) pid = proc.pid;

  if (pid && !Number.isNaN(pid)) {
    try {
      if (process.platform === 'win32') {
        const { execSync } = require('child_process');
        execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
      } else {
        process.kill(pid, 'SIGTERM');
      }
    } catch (err) {
      // already gone — nothing to do
    }
  }
  try {
    if (proc && !proc.killed) proc.kill('SIGTERM');
  } catch (err) {
    // ignore
  }
  if (pidFile) {
    try { fs.unlinkSync(pidFile); } catch (err) { // ignore
    }
  }
}

module.exports = { isPortFree, pickPort, startBackend, pipeBackendLogs, waitForBackend, stopBackend };
