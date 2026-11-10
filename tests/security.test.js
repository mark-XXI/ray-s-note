'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { isTrustedFrame, isAuthorizedNoteUpdate } = require('../src/security/ipc-policy');

const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

function bridge(file, name) {
  const listeners = new Map();
  const calls = [];
  let exposed;
  const ipcRenderer = {
    on(channel, callback) { listeners.set(channel, callback); },
    send(channel, ...args) { calls.push({ channel, args }); },
    invoke(channel, ...args) { calls.push({ channel, args }); return Promise.resolve({ ok: true }); },
  };
  vm.runInNewContext(read(file), {
    require(specifier) {
      assert.equal(specifier, 'electron');
      return { ipcRenderer, contextBridge: { exposeInMainWorld(key, api) {
        assert.equal(key, name); exposed = api;
      } } };
    },
  });
  assert.ok(exposed, 'preload API not exposed');
  return { exposed, listeners, calls };
}

test('trusted sender requires the actual main frame of the expected window', () => {
  const wc = { mainFrame: {}, isDestroyed: () => false };
  assert.equal(isTrustedFrame({ sender: wc, senderFrame: wc.mainFrame }, wc), true);
  assert.equal(isTrustedFrame({ sender: wc, senderFrame: {} }, wc), false);
  assert.equal(isTrustedFrame({ sender: {}, senderFrame: wc.mainFrame }, wc), false);
  assert.equal(isTrustedFrame({ sender: wc }, wc), false);
  assert.equal(isTrustedFrame(null, wc), false);
  wc.isDestroyed = () => true;
  assert.equal(isTrustedFrame({ sender: wc, senderFrame: wc.mainFrame }, wc), false);
});

test('note updates require matching IDs and valid shapes', () => {
  const good = { id: 12, content: '<b>Hello</b>', color: '#FFF9C4', fontSize: 15, dir: 'rtl' };
  assert.equal(isAuthorizedNoteUpdate(12, good), true);
  for (const changed of [
    { ...good, id: 13 }, { ...good, hidden: true }, { ...good, content: 7 },
    { ...good, fontSize: 15.1 }, { ...good, dir: 'auto' }, null, [],
  ]) assert.equal(isAuthorizedNoteUpdate(12, changed), false);
});

test('note preload exposes only the named, limited API', async () => {
  const { exposed, listeners, calls } = bridge('src/preload/note.js', 'raysNote');
  assert.deepEqual(Object.keys(exposed).sort(),
    ['onInit', 'onPinChanged', 'togglePin', 'onFlushRequest', 'save', 'flushResult', 'close', 'hide', 'create', 'dashboard'].sort());
  assert.equal(exposed.send, undefined);
  exposed.close(); exposed.hide(); exposed.create(); exposed.dashboard();
  assert.deepEqual(calls.map(call => call.channel),
    ['note-close', 'note-minimize', 'note-new', 'open-dashboard']);
  await exposed.save({ id: 7, content: 'Test', color: '#FFF9C4', fontSize: 15, dir: 'rtl', hidden: true });
  assert.equal(calls.at(-1).channel, 'note-update');
  assert.equal(Object.hasOwn(calls.at(-1).args[0], 'hidden'), false);
  let received;
  exposed.onInit(note => received = note);
  listeners.get('init')({ sender: { secret: true } }, { id: 7 });
  assert.equal(received.id, 7);
  assert.equal(received.sender, undefined);
  await exposed.togglePin();
  assert.equal(calls.at(-1).channel, 'toggle-note-pin');
  assert.deepEqual(calls.at(-1).args, [], 'note controls may not choose a target ID');
  let pinState;
  exposed.onPinChanged(pinned => { pinState = pinned; });
  listeners.get('note-pin-changed')({ sender: { private: true } }, true);
  assert.equal(pinState, true);
});

test('preload flush events do not expose raw Electron event objects', () => {
  const { exposed, listeners, calls } = bridge('src/preload/note.js', 'raysNote');
  let requestId;
  exposed.onFlushRequest(id => requestId = id);
  listeners.get('app-flush-request')({ sender: 'private' }, 'req-123');
  assert.equal(requestId, 'req-123');
  exposed.flushResult('req-123', true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), {
    channel: 'app-flush-result', args: [{ requestId: 'req-123', ok: true }],
  });
});

test('dashboard preload cannot access note-save IPC', () => {
  const { exposed, calls, listeners } = bridge('src/preload/dashboard.js', 'raysDashboard');
  assert.deepEqual(Object.keys(exposed).sort(),
    ['onNotes', 'requestNotes', 'create', 'show', 'hide', 'pin', 'delete'].sort());
  assert.equal(exposed.save, undefined);
  exposed.requestNotes(); exposed.create(); exposed.show(1); exposed.hide(1); exposed.pin(1); exposed.delete(1);
  assert.deepEqual(calls.map(call => call.channel),
    ['get-notes', 'new-note-from-dash', 'show-note', 'hide-note', 'pin-note', 'delete-note']);
  let result;
  exposed.onNotes(notes => result = notes);
  listeners.get('notes-list')({ sender: 'private' }, [{ id: 1 }]);
  assert.equal(result[0].id, 1);
});

test('both windows use isolated sandboxed renderers and separate preloads', () => {
  const main = read('main.js');
  assert.equal((main.match(/nodeIntegration: false/g) || []).length, 2);
  assert.equal((main.match(/contextIsolation: true/g) || []).length, 2);
  assert.equal((main.match(/sandbox: true/g) || []).length, 2);
  assert.match(main, /src\/preload\/note\.js/);
  assert.match(main, /src\/preload\/dashboard\.js/);
});

test('main process authorizes privileged IPC operations by sender', () => {
  const main = read('main.js');
  assert.match(main, /isAuthorizedNoteUpdate\(id, data\)/);
  assert.match(main, /trustedNoteId\(event\)/);
  assert.match(main, /trustedDashboard\(event\)/);
  assert.match(main, /setWindowOpenHandler/);
  assert.match(main, /will-navigate/);
  assert.match(main, /setPermissionRequestHandler/);
});

test('HTML pages have restrictive CSP and no executable inline handlers', () => {
  for (const filename of ['note.html', 'dashboard.html']) {
    const html = read(filename);
    assert.match(html, /Content-Security-Policy/);
    assert.match(html, /script-src 'self'/);
    assert.match(html, /object-src 'none'/);
    assert.doesNotMatch(html, /on(?:click|input|change|error|load)\s*=/i);
    assert.doesNotMatch(html, /<script(?![^>]*src=)[^>]*>/i);
  }
});

test('note HTML is allowlisted on load and before saving; paste is text-only', () => {
  const script = read('src/renderer/note.js');
  const sanitizer = read('src/renderer/note-html.js');
  assert.match(script, /RaysNoteHtml\.sanitize\(note\.content/);
  assert.match(script, /RaysNoteHtml\.sanitize\(window\.RaysNoteTasks\.serializedHTML\(editor\)\)/);
  assert.match(script, /clipboardData\?\.getData\('text\/plain'\)/);
  assert.match(sanitizer, /blocked\.has\(tag\)/);
  assert.match(sanitizer, /safeStyle\(node, clean\)/);
  assert.match(sanitizer, /node\.getAttribute\('type'\)/);
});

test('dashboard previews use textContent and cannot insert note HTML', () => {
  const script = read('src/renderer/dashboard.js');
  assert.match(script, /querySelector\('\.note-preview'\)\.textContent/);
  assert.doesNotMatch(script, /<div class="note-preview[^>]*>\$\{preview\}/);
  assert.doesNotMatch(script, /onclick=/);
});

test('renderer scripts never import Electron or use raw ipcRenderer', () => {
  for (const file of ['src/renderer/note.js', 'src/renderer/dashboard.js', 'src/renderer/note-html.js', 'src/renderer/note-tasks.js']) {
    assert.doesNotMatch(read(file), /ipcRenderer|require\(['"]electron['"]\)/);
  }
});
