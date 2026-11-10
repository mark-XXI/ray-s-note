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
