'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

function getTestDataDirectory() {
  // Stored in this repository, ignored by Git. Never uses the normal AppData profile.
  return path.resolve(__dirname, '..', '.rays-note-test-data');
}

function startTestApp() {
  const root = path.resolve(__dirname, '..');
  const dataDir = getTestDataDirectory();
  const electronPath = require('electron');

  fs.mkdirSync(dataDir, { recursive: true });
  process.stdout.write(`Ray's Note test profile: ${dataDir}\n`);
  process.stdout.write('This launch does not use the normal Ray\'s Note notes.json.\n');

  const child = spawn(electronPath, [root], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      RAYS_NOTE_TEST_DATA_DIR: dataDir,
    },
  });

  child.on('error', (error) => {
    process.stderr.write(`Failed to launch Electron: ${error.message}\n`);
    process.exitCode = 1;
  });

  child.on('exit', (code, signal) => {
    if (signal) process.stderr.write(`Electron terminated by signal: ${signal}\n`);
    process.exitCode = Number.isInteger(code) ? code : (signal ? 1 : 0);
  });
}

if (require.main === module) startTestApp();

module.exports = { getTestDataDirectory };
