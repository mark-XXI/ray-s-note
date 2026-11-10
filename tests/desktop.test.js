'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DesktopLayer } = require('../src/windows/desktop-layer');

function setup({ worker = 123n, owner = 0n, invalid = false } = {}) {
  let currentWorker = worker;
  let currentOwner = owner;
  let alive = !invalid;
  const calls = [];
  const win = { isDestroyed: () => !alive };
  const warnings = [];
  const adapter = {
    noteHandle: () => 456n,
    isWindow: () => alive,
    findWorker: () => currentWorker,
    getOwner: () => currentOwner,
    setOwner(hwnd, value) {
      calls.push([hwnd, value]);
      currentOwner = BigInt(value);
    },
  };
  const controller = new DesktopLayer({ adapter, warn: m => warnings.push(m) });
  return { controller, calls, win, warnings,
    setWorker: x => { currentWorker = x; },
    getOwner: () => currentOwner,
    setOwnerExternally: x => { currentOwner = x; },
    setAlive: x => { alive = x; },
    adapter,
  };
}

test('desktop attachment owns unpinned note by Explorer layer', () => {
  const h = setup();
  assert.equal(h.controller.attach(h.win), true);
  assert.equal(h.getOwner(), 123n);
  assert.deepEqual(h.calls, [[456n, 123n]]);
});

test('repeated attachment does not rewrite owner if unchanged', () => {
  const h = setup();
  h.controller.attach(h.win);
  assert.equal(h.controller.ensure(h.win), true);
  assert.equal(h.calls.length, 1);
});

test('detachment restores original owner before native pinning', () => {
  const h = setup();
  h.controller.attach(h.win);
  assert.equal(h.controller.detach(h.win), true);
  assert.equal(h.getOwner(), 0n);
  assert.deepEqual(h.calls, [[456n, 123n], [456n, 0n]]);
});

test('Explorer restart reattaches to a new WorkerW without changing note data', () => {
  const h = setup();
  h.controller.attach(h.win);
  h.setWorker(999n);
  assert.equal(h.controller.ensure(h.win), true);
  assert.equal(h.getOwner(), 999n);
  assert.deepEqual(h.calls.at(-1), [456n, 999n]);
});

test('missing desktop host fails safely with no native changes', () => {
  const h = setup({ worker: null });
  assert.equal(h.controller.attach(h.win), false);
  assert.deepEqual(h.calls, []);
  assert.match(h.warnings[0], /fallback/);
});

test('existing foreign owner is never overwritten', () => {
  const h = setup({ owner: 111n });
  assert.equal(h.controller.attach(h.win), false);
  assert.equal(h.getOwner(), 111n);
});

test('external owner changes are not forcibly replaced', () => {
  const h = setup();
  h.controller.attach(h.win);
  h.setOwnerExternally(333n);
  assert.equal(h.controller.ensure(h.win), false);
  h.controller.detach(h.win);
  assert.equal(h.getOwner(), 333n);
});

test('closed note is forgotten without touching dead Windows handles', () => {
  const h = setup();
  h.controller.attach(h.win);
  h.setAlive(false);
  h.controller.forget(h.win);
  assert.equal(h.controller.detach(h.win), true);
  assert.equal(h.calls.length, 1);
});

test('native adapter is loaded only on Windows x64', () => {
  if (process.platform === 'win32' && process.arch === 'x64') return;
  const { createWindowsDesktopAdapter } = require('../src/windows/win32-desktop');
  assert.throws(() => createWindowsDesktopAdapter(), /Windows x64/);
});

test('desktop integration removes recovery and tray toggles', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.doesNotMatch(main, /restoreOnShowDesktop|revealVisibleNotes|desktopWatchers|startDesktopWatcher/);
  assert.doesNotMatch(main, /label: 'Recover notes after Win\+D'|label: 'Reveal Visible Notes'/);
  assert.match(main, /new DesktopLayer\(/);
  assert.match(main, /desktopLayer\.attach\(win\)/);
  assert.match(main, /desktopLayer\.detach\(win\)/);
  assert.match(main, /win\.hookWindowMessage\(desktopShellMessage/);
});

test('existing renderer and icon remain unchanged', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /alwaysOnTop: note\.pinned === true/);
  const html = fs.readFileSync(path.join(__dirname, '..', 'note.html'), 'utf8');
  assert.match(html, /id="wb-pin"/);
  assert.match(html, /#wb-pin\.pinned/);
});
