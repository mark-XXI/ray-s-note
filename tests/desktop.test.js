'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DesktopLayer } = require('../src/windows/desktop-layer');

const POPUP_STYLE = 0x80000000n;

function setup({ host = 123n, parent = 0n, invalid = false,
  attachFailure = false, detachFailure = false, rehostFailure = false } = {}) {
  let currentHost = host;
  let currentParent = parent;
  let style = POPUP_STYLE;
  let alive = !invalid;
  const calls = [];
  const win = { isDestroyed: () => !alive };
  const warnings = [];
  const adapter = {
    noteHandle: () => 456n,
    isWindow: () => alive,
    findDesktopHost: () => currentHost,
    getParent: () => currentParent,
    attachChild(hwnd, target) {
      calls.push(['attachChild', hwnd, target]);
      if (attachFailure) throw new Error('native attach failed');
      assert.equal(currentParent, 0n);
      currentParent = target;
      const old = style;
      style = 0x40000000n;
      return old;
    },
    detachChild(hwnd, target, originalStyle) {
      calls.push(['detachChild', hwnd, target, originalStyle]);
      if (detachFailure) throw new Error('native detach failed');
      assert.equal(currentParent, target);
      currentParent = 0n;
      style = originalStyle;
    },
    rehostChild(hwnd, oldHost, newHost) {
      calls.push(['rehostChild', hwnd, oldHost, newHost]);
      if (rehostFailure) throw new Error('native rehost failed');
      assert.equal(currentParent, oldHost);
      currentParent = newHost;
    },
  };
  const controller = new DesktopLayer({ adapter, warn: message => warnings.push(message) });
  return { controller, calls, win, warnings,
    setHost: value => { currentHost = value; },
    getParent: () => currentParent,
    setParentExternally: value => { currentParent = value; },
    setAlive: value => { alive = value; },
    style: () => style,
    adapter,
  };
}

test('unpinned note becomes a desktop CHILD, not an owned top-level window', () => {
  const h = setup();
  assert.equal(h.controller.attach(h.win), true);
  assert.equal(h.getParent(), 123n);
  assert.equal(h.style(), 0x40000000n);
  assert.deepEqual(h.calls, [['attachChild', 456n, 123n]]);
});

test('repeated desktop attachment does not rewrite native parent', () => {
  const h = setup();
  h.controller.attach(h.win);
  assert.equal(h.controller.ensure(h.win), true);
  assert.equal(h.calls.length, 1);
});

test('pinning restores independent top-level style and parent', () => {
  const h = setup();
  h.controller.attach(h.win);
  assert.equal(h.controller.detach(h.win), true);
  assert.equal(h.getParent(), 0n);
  assert.equal(h.style(), POPUP_STYLE);
  assert.deepEqual(h.calls.at(-1), ['detachChild', 456n, 123n, POPUP_STYLE]);
});

test('Explorer restarts rehost the child into the replacement desktop view', () => {
  const h = setup();
  h.controller.attach(h.win);
  h.setHost(999n);
  assert.equal(h.controller.ensure(h.win), true);
  assert.equal(h.getParent(), 999n);
  assert.deepEqual(h.calls.at(-1), ['rehostChild', 456n, 123n, 999n]);
});

test('missing desktop view fails closed rather than creating an ordinary note', () => {
  const h = setup({ host: null });
  assert.equal(h.controller.attach(h.win), false);
  assert.deepEqual(h.calls, []);
  assert.match(h.warnings[0], /cannot be shown safely/);
});

test('native attachment error leaves note unattached and reports the failure', () => {
  const h = setup({ attachFailure: true });
  assert.equal(h.controller.attach(h.win), false);
  assert.equal(h.getParent(), 0n);
  assert.match(h.warnings[0], /native attach failed/);
});

test('a pre-existing foreign parent or owner is never overwritten', () => {
  const h = setup({ parent: 111n });
  assert.equal(h.controller.attach(h.win), false);
  assert.equal(h.getParent(), 111n);
});

test('unexpected external parent is not overwritten or detached', () => {
  const h = setup();
  h.controller.attach(h.win);
  h.setParentExternally(333n);
  assert.equal(h.controller.ensure(h.win), false);
  assert.equal(h.controller.detach(h.win), false);
  assert.equal(h.getParent(), 333n);
});

test('failed native detach does not lose bookkeeping or allow pinning', () => {
  const h = setup({ detachFailure: true });
  h.controller.attach(h.win);
  assert.equal(h.controller.detach(h.win), false);
  assert.equal(h.getParent(), 123n);
  assert.equal(h.controller.attached.has(h.win), true);
  assert.match(h.warnings.at(-1), /native detach failed/);
});

test('failed Explorer rehost keeps the original parent record', () => {
  const h = setup({ rehostFailure: true });
  h.controller.attach(h.win);
  h.setHost(999n);
  assert.equal(h.controller.ensure(h.win), false);
  assert.equal(h.getParent(), 123n);
  assert.equal(h.controller.attached.get(h.win).host, 123n);
});

test('closed note is forgotten without modifying dead HWNDs', () => {
  const h = setup();
  h.controller.attach(h.win);
  h.setAlive(false);
  h.controller.forget(h.win);
  assert.equal(h.controller.detach(h.win), true);
  assert.equal(h.calls.length, 1);
});

test('native adapter remains Windows-x64-only by default', () => {
  if (process.platform === 'win32' && process.arch === 'x64') return;
  const { createWindowsDesktopAdapter } = require('../src/windows/win32-desktop');
  assert.throws(() => createWindowsDesktopAdapter(), /Windows x64/);
});

test('main process rejects normal-window fallback for unpinned notes', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /!desktopLayer \|\| !desktopLayer\.attach\(win\)/);
  assert.match(main, /win\.destroy\(\);\s*openDashboard\(\)/);
  assert.match(main, /win\.hide\(\); \/\/ A missing desktop host/);
  assert.match(main, /desktopLayer\.detach\(win\)/);
  assert.match(main, /desktopLayer\.ensure\(win\)/);
  assert.match(main, /win\.setAlwaysOnTop\(true, 'floating'\)/);
  assert.match(main, /win\.setAlwaysOnTop\(false, 'floating'\)/);
});

test('desktop adapter uses actual WS_CHILD/SetParent instead of GWLP owner', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/windows/win32-desktop.js'), 'utf8');
  assert.match(source, /WS_CHILD = 0x40000000n/);
  assert.match(source, /SetParent = user32\.func/);
  assert.match(source, /ScreenToClient = user32\.func/);
  assert.match(source, /getParent\(hwnd\) !== host/);
  assert.doesNotMatch(source, /setOwner\(/);
});

test('old desktop recovery and tray toggle hacks remain absent', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.doesNotMatch(main, /restoreOnShowDesktop|revealVisibleNotes|desktopWatchers|startDesktopWatcher/);
  assert.doesNotMatch(main, /label: 'Recover notes after Win\+D'|label: 'Reveal Visible Notes'/);
  assert.match(main, /new DesktopLayer\(/);
  assert.match(main, /desktopLayer\.attach\(win\)/);
  assert.match(main, /desktopLayer\.detach\(win\)/);
  assert.match(main, /win\.hookWindowMessage\(desktopShellMessage/);
});

test('note renderer and pin icon are not modified', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /alwaysOnTop: note\.pinned === true/);
  const html = fs.readFileSync(path.join(__dirname, '..', 'note.html'), 'utf8');
  assert.match(html, /id="wb-pin"/);
  assert.match(html, /#wb-pin\.pinned/);
});

function fakeWin32() {
  const notes = new Map([[456n, {
    parent: 0n,
    style: 0x80040000n,
    r: { left: 240, top: 150, right: 540, bottom: 510 },
  }]]);
  const host = 123n;
  let rejectParent = false;
  const hostOffset = { x: 100, y: 50 };
  const calls = [];
  const actions = {
    FindWindowExW(top, _after, klass) { return top === 1n && klass === 'SHELLDLL_DefView' ? host : 0n; },
    EnumWindows(callback) { callback(1n); return 1; },
    IsWindow(hwnd) { return hwnd === host || notes.has(BigInt(hwnd)) ? 1 : 0; },
    GetWindowLongPtrW(hwnd, index) {
      const item = notes.get(BigInt(hwnd));
      if (!item) return 0n;
      return index === -8 ? item.parent : BigInt.asIntN(32, item.style);
    },
    SetWindowLongPtrW(hwnd, index, value) {
      const item = notes.get(BigInt(hwnd));
      if (index === -16) item.style = BigInt.asUintN(32, BigInt(value));
      return 1n;
    },
    SetParent(hwnd, parent) {
      calls.push(['SetParent', BigInt(parent)]);
      const item = notes.get(BigInt(hwnd));
      const old = item.parent;
      if (!rejectParent) item.parent = BigInt(parent);
      return old;
    },
    SetWindowPos(hwnd, _after, x, y, width, height) {
      calls.push(['SetWindowPos', x, y]);
      const item = notes.get(BigInt(hwnd));
      const offset = item.parent === host ? hostOffset : { x: 0, y: 0 };
      item.r = { left: x + offset.x, top: y + offset.y,
        right: x + offset.x + width, bottom: y + offset.y + height };
      return 1;
    },
    GetWindowRect(hwnd, result) { Object.assign(result, notes.get(BigInt(hwnd)).r); return 1; },
    ScreenToClient(hwnd, p) {
      if (hwnd !== host) return 0;
      p.x -= hostOffset.x;
      p.y -= hostOffset.y;
      return 1;
    },
    RegisterWindowMessageW() { return 1234; },
  };
  const koffiModule = {
    load() { return { func(signature) {
      const name = /__stdcall ([A-Za-z0-9_]+)\(/.exec(signature)?.[1];
      assert.ok(name in actions, `mock native function missing: ${name}`);
      return actions[name];
    } }; },
    proto() { return {}; },
    struct() { return {}; },
  };
  const { createWindowsDesktopAdapter } = require('../src/windows/win32-desktop');
  const adapter = createWindowsDesktopAdapter({ koffiModule, platform: 'win32', arch: 'x64' });
  return { adapter, calls, notes, host, rejectParent: value => { rejectParent = value; } };
}

test('native adapter converts screen-to-parent coordinates and reverses them on pin', () => {
  const h = fakeWin32();
  assert.equal(h.adapter.findDesktopHost(), h.host);
  const before = { ...h.notes.get(456n).r };
  const originalStyle = h.adapter.attachChild(456n, h.host);
  assert.equal(originalStyle, 0x80040000n);
  assert.equal(h.adapter.getParent(456n), h.host);
  assert.equal(h.notes.get(456n).style, 0x40040000n);
  assert.deepEqual(h.notes.get(456n).r, before);
  assert.deepEqual(h.calls.at(-1), ['SetWindowPos', 140, 100]);
  h.adapter.detachChild(456n, h.host, originalStyle);
  assert.equal(h.adapter.getParent(456n), 0n);
  assert.equal(h.notes.get(456n).style, originalStyle);
  assert.deepEqual(h.notes.get(456n).r, before);
});

test('native adapter refuses failed SetParent and restores original style', () => {
  const h = fakeWin32();
  h.rejectParent(true);
  const before = { ...h.notes.get(456n).r };
  assert.throws(() => h.adapter.attachChild(456n, h.host), /rejected desktop window parent/);
  assert.equal(h.adapter.getParent(456n), 0n);
  assert.equal(h.notes.get(456n).style, 0x80040000n);
  assert.deepEqual(h.notes.get(456n).r, before);
});
