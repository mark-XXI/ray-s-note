'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { startDesktopWatcher } = require('../desktop-pin');

function setup({ enabled = true, allowed = true, minimized = false } = {}) {
  const win = new EventEmitter();
  let destroyed = false;
  let isMinimized = minimized;
  let canRestore = allowed;
  const pending = new Map();
  let counter = 0;
  const calls = [];
  win.isDestroyed = () => destroyed;
  win.isMinimized = () => isMinimized;
  win.isVisible = () => true;
  win.restore = () => { calls.push('restore'); isMinimized = false; win.emit('restore'); };
  win.setMinimized = (value) => { isMinimized = value; if (value) win.emit('minimize'); };
  win.destroy = () => { destroyed = true; win.emit('closed'); };
  const guard = startDesktopWatcher(win, {
    enabled, delayMs: 350,
    schedule(fn, ms) { calls.push(['schedule', ms]); const id = ++counter; pending.set(id, fn); return id; },
    cancel(id) { calls.push(['cancel', id]); pending.delete(id); },
    shouldRestore: () => canRestore,
    onError: e => calls.push(['error', e.message]),
  });
  function tick() {
    const scheduled = [...pending]; pending.clear();
    for (const [, fn] of scheduled) fn();
  }
  return { win, guard, calls, tick, pending, setAllowed(v) { canRestore = v; } };
}

test('ordinary window activity never creates a timer or polls in the background', () => {
  const s = setup();
  s.win.emit('show'); s.win.emit('focus'); s.win.emit('blur');
  assert.equal(s.pending.size, 0);
  assert.deepEqual(s.calls, []);
  s.guard.stop();
});

test('Win+D minimize schedules one delayed restore rather than repeated polling', () => {
  const s = setup();
  s.win.setMinimized(true);
  s.win.emit('minimize');
  assert.deepEqual(s.calls, [['schedule', 350]]);
  s.tick();
  assert.equal(s.calls.filter(x=>x==='restore').length, 1);
  assert.equal(s.pending.size, 0);
});

test('system restored window cancels scheduled recovery', () => {
  const s = setup();
  s.win.setMinimized(true);
  s.win.restore();
  assert.equal(s.pending.size, 0);
  s.tick();
  assert.equal(s.calls.filter(x=>x==='restore').length, 1);
});

test('disabled recovery respects system minimization and cancels its timer', () => {
  const s = setup();
  s.win.setMinimized(true);
  s.guard.setEnabled(false);
  assert.equal(s.pending.size, 0);
  s.tick();
  assert.equal(s.calls.filter(x=>x==='restore').length, 0);
  s.guard.setEnabled(true);
  assert.equal(s.pending.size, 1);
  s.tick();
  assert.equal(s.calls.filter(x=>x==='restore').length, 1);
});

test('explicitly hidden note will never be restored by a pending timer', () => {
  const s = setup();
  s.win.setMinimized(true);
  s.setAllowed(false);
  s.tick();
  assert.equal(s.calls.filter(x=>x==='restore').length, 0);
});

test('user-hide flag remains respected for compatibility with lifecycle code', () => {
  const s = setup();
  s.win.setMinimized(true);
  s.win._userHide = true;
  s.tick();
  assert.equal(s.calls.filter(x=>x==='restore').length, 0);
});

test('closing a window cancels queued restore and clears registered listeners', () => {
  const s = setup();
  s.win.setMinimized(true);
  s.win.destroy();
  s.tick();
  assert.equal(s.calls.filter(x=>x==='restore').length, 0);
  assert.equal(s.win.listenerCount('minimize'), 0);
  assert.equal(s.win.listenerCount('hide'), 0);
  assert.equal(s.win.listenerCount('closed'), 0);
});

test('manual hide event does not schedule new restore', () => {
  const s = setup();
  s.win.emit('hide');
  assert.equal(s.pending.size, 0);
});

test('native restore failure is reported without infinite retries', () => {
  const s = setup();
  s.win.restore = () => { throw new Error('restore denied'); };
  s.win.setMinimized(true);
  s.tick();
  assert.deepEqual(s.calls.at(-1), ['error', 'restore denied']);
  assert.equal(s.pending.size, 0);
});

test('tray recovery includes only saved-visible notes and never changes storage', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const source = main.slice(main.indexOf('function revealVisibleNotes()'), main.indexOf('function setDesktopRecovery('));
  assert.match(source, /if \(note\.hidden\) continue/);
  assert.match(source, /win\.moveTop\(\)/);
  assert.match(source, /win\.showInactive\(\)/);
  assert.doesNotMatch(source, /changeNote\(|commitNotes\(|\.focus\(/);
  assert.match(main, /label: 'Recover notes after Win\+D', type: 'checkbox'/);
  assert.match(main, /label: 'Reveal Visible Notes'/);
});

test('desktop watcher is attached after ready-to-show and stopped on close', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /desktopWatchers\.set\(note\.id, watcher\)/);
  assert.match(main, /if \(watcher\) watcher\.stop\(\)/);
  assert.match(main, /watcher\.setEnabled\(restoreOnShowDesktop\)/);
  assert.match(main, /note\.pinned === true/);
});

test('titlebar pin is grayscale and glyph only appears on hover or focus', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'note.html'), 'utf8');
  assert.match(html, /id="wb-pin"[\s\S]*?<svg aria-hidden="true"/);
  assert.match(html, /#wb-pin \{[\s\S]*?color: transparent/);
  assert.match(html, /#wb-pin\.pinned \{[\s\S]*?rgba\(0,0,0,0\.30\)/);
  assert.doesNotMatch(html, /#wb-pin\.pinned \{[^}]*#[0-9a-fA-F]{3,8}/);
  assert.doesNotMatch(html, /📌/);
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/note.js'), 'utf8');
  assert.match(renderer, /pinBtn\.setAttribute\('aria-pressed'/);
});
