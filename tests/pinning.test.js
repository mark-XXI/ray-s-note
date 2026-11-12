'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { NotePinning } = require('../src/windows/note-pinning');

const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

function harness({ pinned = false, hidden = false, withWindow = true, nativeFailure = false,
  persistFailure = false, rollbackFailure = false } = {}) {
  const note = { id: 17, pinned, hidden };
  const calls = [];
  let native = pinned;
  let writes = 0;
  const win = withWindow ? {
    isDestroyed: () => false,
    isAlwaysOnTop: () => native,
    setAlwaysOnTop(value, level) {
      calls.push(['native', value, level]);
      if (nativeFailure || (rollbackFailure && value === pinned)) {
        throw new Error('native window failed');
      }
      native = value;
    },
  } : undefined;
  const controller = new NotePinning({
    getNote(id) { return id === note.id ? note : null; },
    getWindow: () => win,
    persistPinned(id, value) {
      calls.push(['save', id, value]);
      writes += 1;
      if (persistFailure) return false;
      note.pinned = value;
      return true;
    },
    notify(id, value) { calls.push(['notify', id, value]); },
    reportError(error) { calls.push(['error', error.message]); },
  });
  return { note, win, controller, calls, getNative: () => native,
    getWriteCount: () => writes };
}

test('pinning an open note sets floating topmost before writing and notifying', () => {
  const h = harness();
  assert.deepEqual(h.controller.set(17, true), { ok: true, pinned: true });
  assert.equal(h.getNative(), true);
  assert.equal(h.note.pinned, true);
  assert.deepEqual(h.calls, [['native', true, 'floating'], ['save', 17, true], ['notify', 17, true]]);
});

test('unpinning restores normal native z-order without closing the editor', () => {
  const h = harness({ pinned: true });
  assert.deepEqual(h.controller.set(17, false), { ok: true, pinned: false });
  assert.equal(h.getNative(), false);
  assert.deepEqual(h.calls[0], ['native', false, 'floating']);
});

test('hidden notes retain their visibility and persist pin for next open', () => {
  const h = harness({ hidden: true, withWindow: false });
  assert.equal(h.controller.toggle(17).ok, true);
  assert.equal(h.note.hidden, true);
  assert.equal(h.note.pinned, true);
  assert.deepEqual(h.calls, [['save', 17, true], ['notify', 17, true]]);
});

test('a native failure never changes saved pin state', () => {
  const h = harness({ nativeFailure: true });
  assert.equal(h.controller.toggle(17).ok, false);
  assert.equal(h.note.pinned, false);
  assert.equal(h.getWriteCount(), 0);
  assert.equal(h.calls.at(-1)[0], 'error');
});

test('a storage failure rolls back native window state and does not notify', () => {
  const h = harness({ persistFailure: true });
  assert.equal(h.controller.toggle(17).ok, false);
  assert.equal(h.note.pinned, false);
  assert.equal(h.getNative(), false);
  assert.deepEqual(h.calls, [['native', true, 'floating'], ['save', 17, true], ['native', false, 'floating']]);
});

test('rollback failures are surfaced rather than silently ignored', () => {
  const h = harness({ persistFailure: true, rollbackFailure: true });
  assert.equal(h.controller.toggle(17).ok, false);
  assert.equal(h.note.pinned, false);
  assert.equal(h.calls.at(-1)[0], 'error');
});

test('redundant set is idempotent and does not write or move the window', () => {
  const h = harness({ pinned: true });
  assert.deepEqual(h.controller.set(17, true), { ok: true, pinned: true });
  assert.equal(h.getWriteCount(), 0);
  assert.deepEqual(h.calls, []);
});

test('unknown IDs and invalid pin values fail closed', () => {
  const h = harness();
  assert.equal(h.controller.toggle(99).ok, false);
  assert.equal(h.controller.set(17, 'true').ok, false);
  assert.deepEqual(h.calls, []);
});

test('window construction restores the persisted native topmost state', () => {
  const source = read('main.js');
  assert.match(source, /alwaysOnTop:\s*note\.pinned === true/);
  assert.match(source, /new NotePinning\(/);
  assert.match(source, /notePinning\.toggle\(id\)/);
  assert.match(source, /trustedNoteId\(event\)/);
  assert.match(source, /trustedDashboard\(event\)/);
});

test('native pin controls do not silently change visibility or focus', () => {
  const source = read('src/windows/note-pinning.js');
  assert.doesNotMatch(source, /\.show\(|\.hide\(|\.focus\(|\.destroy\(/);
  assert.doesNotMatch(source, /alwaysOnTop: true/);
});

test('pin control state is accessible and updated from startup and dashboard', () => {
  const html = read('note.html');
  const renderer = read('src/renderer/note.js');
  assert.match(html, /id="wb-pin"[^>]*aria-pressed="false"/);
  assert.match(renderer, /renderPinState\(note\.pinned === true\)/);
  assert.match(renderer, /noteAPI\.onPinChanged/);
  assert.match(renderer, /noteAPI\.togglePin\(\)/);
  assert.match(renderer, /pinBtn\.disabled = true/);
  assert.match(read('src/renderer/dashboard.js'), /Pin on top/);
});

test('existing close, hide, tray lifecycle, and editor routes are retained', () => {
  const main = read('main.js');
  const note = read('src/renderer/note.js');
  for (const name of ['note-close', 'note-minimize', 'pin-note', 'toggle-note-pin', 'note-update']) {
    assert.match(main, new RegExp(`ipcMain\\.(?:on|handle)\\('${name}'`));
  }
  assert.match(main, /noteLifecycle\.hide\(/);
  assert.match(main, /noteLifecycle\.showAll\(/);
  assert.match(note, /RaysNoteTasks\.insertAtSelection/);
  assert.match(note, /RaysNoteBullets\.toggle/);
});


test('native desktop adapter switches modes without changing stored note until save', () => {
  const h = harness();
  const nativeCalls = [];
  h.controller.applyNativePinState = (_win, pinned) => nativeCalls.push(pinned);
  assert.equal(h.controller.toggle(17).ok, true);
  assert.deepEqual(nativeCalls, [true]);
  assert.equal(h.note.pinned, true);
});

test('failed save rolls back desktop attachment mode', () => {
  const h = harness({ persistFailure: true });
  const nativeCalls = [];
  h.controller.applyNativePinState = (_win, pinned) => nativeCalls.push(pinned);
  assert.equal(h.controller.toggle(17).ok, false);
  assert.deepEqual(nativeCalls, [true, false]);
});


test('renderer initialization handshake survives an early missed init event', () => {
  const renderer = read('src/renderer/note.js');
  const preload = read('src/preload/note.js');
  const main = read('main.js');
  const vm = require('node:vm');
  const callbacks = new Map();
  const outgoing = [];
  let api;
  const ipcRenderer = {
    on(channel, listener) { callbacks.set(channel, listener); },
    send(channel) { outgoing.push(channel); },
    invoke() { return Promise.resolve({ ok: true }); },
  };
  const sandbox = {
    require(name) {
      assert.equal(name, 'electron');
      return {
        contextBridge: { exposeInMainWorld(name, exposed) {
          assert.equal(name, 'raysNote');
          api = exposed;
        } },
        ipcRenderer,
      };
    },
  };
  vm.runInNewContext(preload, sandbox);
  let initialized = null;
  api.onInit(note => { initialized = note; });
  assert.equal(initialized, null); // early main-process send was missed
  api.requestInit();
  assert.deepEqual(outgoing, ['request-note-init']);
  assert.equal(typeof callbacks.get('init'), 'function');
  callbacks.get('init')({}, { id: 17, pinned: false });
  assert.equal(initialized.id, 17);

  const listenIndex = renderer.indexOf('noteAPI.onInit((note) => {');
  const requestIndex = renderer.lastIndexOf('noteAPI.requestInit();');
  assert.ok(listenIndex >= 0 && requestIndex > listenIndex, 'renderer must subscribe before requesting init');
  assert.match(renderer, /if \(noteId !== null\) return;/);
  assert.match(main, /ipcMain\.on\('request-note-init', \(event\) => \{\s*const id = trustedNoteId\(event\);/);
  assert.match(main, /win\.webContents\.send\('init', note\)/);
});


// Opt-in safe pin transitions replace a Chromium HWND instead of reparenting
// the same live desktop-child HWND. Storage and edit flushes are mandatory.
const { PinWindowSwap } = require('../src/windows/pin-window-swap');

function swapHarness({ pinned = false, flushResults = [true, true], saveResult = true } = {}) {
  const calls = [];
  const tasks = [];
  const note = { id: 7, pinned, hidden: false, content: 'saved', x: 10, y: 20 };
  let destroyed = false;
  const win = { isDestroyed: () => destroyed, destroy() { destroyed = true; calls.push('destroy'); } };
  const controller = new PinWindowSwap({
    getNote: id => id === 7 ? note : null,
    getWindow: id => id === 7 ? win : null,
    flushWindow: async () => { calls.push('flush'); return flushResults.shift() === true; },
    persistPinned: (_id, value) => {
      calls.push('persist:' + value);
      if (!saveResult) return false;
      note.pinned = value;
      return true;
    },
    openWindow: item => { assert.equal(item, note); calls.push('reopen:' + item.pinned); },
    notify: (_id, value) => calls.push('notify:' + value),
    reportUnsaved: () => calls.push('unsaved'),
    reportError: error => calls.push('error:' + error.message),
    schedule: fn => { tasks.push(fn); },
  });
  return { note, win, calls, tasks, controller };
}

test('desktop child to pinned creates fresh top-level window after both flushes', async () => {
  const h = swapHarness();
  assert.deepEqual(await h.controller.toggle(7), { ok: true, pinned: true });
  assert.deepEqual(h.calls, ['flush', 'persist:true', 'notify:true']);
  assert.equal(h.controller.isBusy(7), true);
  h.tasks.shift()();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.calls, ['flush', 'persist:true', 'notify:true', 'flush', 'destroy', 'reopen:true']);
  assert.equal(h.controller.isBusy(7), false);
});

test('pinned to desktop child creates fresh desktop window', async () => {
  const h = swapHarness({ pinned: true });
  assert.equal((await h.controller.toggle(7)).pinned, false);
  h.tasks.shift()();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.calls.slice(-2), ['destroy', 'reopen:false']);
});

test('failed first editor flush never changes native or saved pin state', async () => {
  const h = swapHarness({ flushResults: [false] });
  assert.equal((await h.controller.toggle(7)).ok, false);
  assert.equal(h.note.pinned, false);
  assert.deepEqual(h.calls, ['flush', 'unsaved']);
  assert.equal(h.tasks.length, 0);
  assert.equal(h.controller.isBusy(7), false);
});

test('failed pin persistence never destroys existing editor', async () => {
  const h = swapHarness({ saveResult: false });
  assert.equal((await h.controller.toggle(7)).ok, false);
  assert.deepEqual(h.calls, ['flush', 'persist:true']);
  assert.equal(h.win.isDestroyed(), false);
});

test('last-moment editor flush failure restores pin state and keeps old editor', async () => {
  const h = swapHarness({ flushResults: [true, false] });
  assert.equal((await h.controller.toggle(7)).ok, true);
  h.tasks.shift()();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.note.pinned, false);
  assert.equal(h.win.isDestroyed(), false);
  assert.deepEqual(h.calls.slice(-3), ['unsaved', 'persist:false', 'notify:false']);
});

test('repeated pin while scheduled is rejected', async () => {
  const h = swapHarness();
  assert.equal((await h.controller.toggle(7)).ok, true);
  assert.equal((await h.controller.toggle(7)).ok, false);
  assert.equal(h.tasks.length, 1);
});

test('main process routes renderer and dashboard pin actions to default-on safe swap', () => {
  const source = read('main.js');
  assert.match(source, /RAYS_NOTE_SAFE_PIN_SWAP !== '0'/);
  assert.match(source, /return togglePinSafely\(id\);/);
  assert.match(source, /void togglePinSafely\(id\);/);
  assert.match(source, /new PinWindowSwap\(/);
  assert.doesNotMatch(read('src/windows/pin-window-swap.js'), /SetParent|SetWindowPos|setAlwaysOnTop/);
});

// Release default: safe window recreation is used automatically, not only in
// a specially configured PowerShell session. The explicit zero is a safety off switch.
test('safe pin-window swap is default-on with an explicit zero opt-out', () => {
  const source = read('main.js');
  assert.match(source, /RAYS_NOTE_SAFE_PIN_SWAP !== '0'/);
  assert.doesNotMatch(source, /RAYS_NOTE_SAFE_PIN_SWAP === '1'/);
});
