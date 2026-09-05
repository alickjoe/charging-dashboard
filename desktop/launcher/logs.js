'use strict';

// Append-with-rotation file logging (same policy as the exe deployment:
// 5 MB per file, one previous copy kept).

const fs = require('fs');
const path = require('path');

const MAX_LOG_BYTES = 5 * 1024 * 1024;

function ensureLogsDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function openLogStream(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size >= MAX_LOG_BYTES) {
      fs.renameSync(filePath, `${filePath}.1`);
    }
  } catch (err) {
    // First run: no log file yet — nothing to rotate.
  }
  return fs.createWriteStream(filePath, { flags: 'a' });
}

function createLoggers(logsDirectory) {
  const dir = ensureLogsDir(logsDirectory);
  const backendLogPath = path.join(dir, 'backend.log');
  const frontendLogPath = path.join(dir, 'frontend.log');

  const backendStream = openLogStream(backendLogPath);
  const frontendStream = openLogStream(frontendLogPath);

  const now = new Date().toISOString();
  const header = `=== AI DB Query started at ${now} ===\n`;
  backendStream.write(header);
  frontendStream.write(header);

  const writeLog = (stream, prefix, message) => {
    if (stream && stream.writable) {
      const ts = new Date().toISOString();
      stream.write(`[${ts}] [${prefix}] ${message}\n`);
    }
  };

  return {
    dir,
    backendLogPath,
    frontendLogPath,
    backend: (prefix, message) => writeLog(backendStream, prefix, message),
    frontend: (prefix, message) => writeLog(frontendStream, prefix, message),
    close: () => {
      if (backendStream) backendStream.end();
      if (frontendStream) frontendStream.end();
    },
  };
}

module.exports = { ensureLogsDir, createLoggers };
