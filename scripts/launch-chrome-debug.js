#!/usr/bin/env node

/**
 * Launch Chrome with remote debugging enabled.
 *
 * Usage:
 *   node scripts/launch-chrome-debug.js [--port 9222]
 *
 * If Chrome is already listening on the given port, prints a message and exits.
 * Otherwise, detects the Chrome executable and launches it with
 * --remote-debugging-port so the Chrome DevTools MCP can connect.
 */

import { execFileSync, spawn } from 'child_process';
import { createConnection } from 'net';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  let port = 9222;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      port = parseInt(args[i + 1], 10);
      i++;
    }
  }

  return { port };
}

/** Check if something is already listening on `port`. */
function isPortInUse(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      resolve(false);
    });
  });
}

/** Detect Chrome executable path per platform. */
function findChrome() {
  const platform = process.platform;

  if (platform === 'win32') {
    const paths = [
      process.env['PROGRAMFILES(X86)'] &&
        resolve(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
      process.env.PROGRAMFILES &&
        resolve(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      process.env.LOCALAPPDATA &&
        resolve(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ].filter(Boolean);

    for (const p of paths) {
      try {
        execFileSync('cmd', ['/c', `if exist "${p}" echo OK`], { stdio: 'pipe', encoding: 'utf-8' });
        return p;
      } catch {
        // not found, try next
      }
    }
  }

  if (platform === 'darwin') {
    const paths = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    ];
    for (const p of paths) {
      try {
        execFileSync('test', ['-f', p], { stdio: 'pipe' });
        return p;
      } catch {
        // not found
      }
    }
  }

  if (platform === 'linux') {
    const names = ['google-chrome', 'google-chrome-stable', 'chromium-browser', 'chromium'];
    for (const name of names) {
      try {
        const out = execFileSync('which', [name], { stdio: 'pipe', encoding: 'utf-8' });
        if (out.trim()) return out.trim();
      } catch {
        // not found
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { port } = parseArgs();

  // Check if Chrome is already listening
  if (await isPortInUse(port)) {
    console.log(`Chrome debug port ${port} is already in use — an instance may be running.`);
    console.log(`DevTools MCP can connect at http://127.0.0.1:${port}`);
    process.exit(0);
  }

  const chromePath = findChrome();
  if (!chromePath) {
    console.error('Could not find Chrome. Install Google Chrome or pass CHROME_PATH env var.');
    console.error('You can also launch Chrome manually with:');
    console.error(`  chrome --remote-debugging-port=${port}`);
    process.exit(1);
  }

  console.log(`Launching Chrome with remote debugging on port ${port}...`);
  console.log(`  Executable: ${chromePath}`);

  const child = spawn(chromePath, [
    `--remote-debugging-port=${port}`,
  ], {
    stdio: 'ignore',
    detached: true,
    shell: process.platform === 'win32',
  });

  child.unref();

  console.log(`Chrome launched (PID ${child.pid}).`);
  console.log(`DevTools MCP can connect at http://127.0.0.1:${port}`);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
