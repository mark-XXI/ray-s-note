'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { getTestDataDirectory } = require('../scripts/start-test');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

// These are baseline structural/smoke checks, not claims about desktop runtime behavior.
test('required application entry points exist', () => {
  for (const name of ['main.js', 'note.html', 'dashboard.html', 'desktop-pin.js', 'note-icon.ico']) {
    assert.ok(fs.statSync(path.join(root, name)).isFile(), `${name} missing`);
  }
});

test('npm scripts support isolated testing without changing dependencies', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.main, 'main.js');
  assert.equal(pkg.scripts.start, 'electron .');
  assert.equal(pkg.scripts['start:test'], 'node scripts/start-test.js');
  assert.equal(pkg.scripts.test, 'node --test tests/baseline.test.js tests/note-store.test.js');
});

test('test user-data directory is local and Git ignored', () => {
  const actual = getTestDataDirectory();
  assert.equal(actual, path.join(root, '.rays-note-test-data'));
  assert.ok(read('.gitignore').split(/\r?\n/).includes('.rays-note-test-data/'));
  assert.match(read('main.js'), /!app\.isPackaged\s*&&\s*process\.env\.RAYS_NOTE_TEST_DATA_DIR/);
  assert.match(read('main.js'), /app\.setPath\('userData', testDir\)/);
});

test('all literal renderer IPC send/invoke channels have main-process handlers', () => {
  const main = read('main.js');
  const sends = [read('note.html'), read('dashboard.html')]
    .flatMap((html) => [...html.matchAll(/ipcRenderer\.(?:send|invoke)\(\s*['"]([^'"]+)['"]/g)])
    .map((match) => match[1]);
  assert.ok(sends.length >= 8, 'unexpectedly few renderer IPC calls');
  for (const channel of new Set(sends)) {
    assert.ok(main.includes(`ipcMain.on('${channel}'`) || main.includes(`ipcMain.handle('${channel}'`), `missing IPC handler: ${channel}`);
  }
});

test('note editor exposes its expected content and editing controls', () => {
  const html = read('note.html');
  assert.match(html, /id="editor"[\s\S]*?contenteditable="true"/);
  for (const handler of ['closeNote', 'hideNote', 'newNote', 'openDash', 'toggleToolbar', 'setColor', 'insertTask']) {
    assert.ok(html.includes(`${handler}(`), `missing editor control: ${handler}`);
  }
});

test('dashboard exposes note management actions', () => {
  const html = read('dashboard.html');
  for (const handler of ['showNote', 'hideNote', 'pinNote', 'deleteNote', 'newNote', 'renderList']) {
    assert.ok(html.includes(`${handler}(`), `missing dashboard action: ${handler}`);
  }
});

test('important existing note IPC routes remain available', () => {
  const main = read('main.js');
  for (const name of ['note-update', 'note-close', 'note-minimize', 'show-note', 'hide-note', 'delete-note', 'pin-note']) {
    assert.ok(main.includes(`ipcMain.on('${name}'`) || main.includes(`ipcMain.handle('${name}'`), `missing note IPC route: ${name}`);
  }
});
