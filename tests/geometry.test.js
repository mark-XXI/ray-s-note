'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const EventEmitter = require('node:events');
const { planNoteBounds, NoteGeometry } = require('../src/windows/note-geometry');

const primary = { id: 1, primary: true, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const left = { id: 2, workArea: { x: -1280, y: -40, width: 1280, height: 984 } };
const right = { id: 3, workArea: { x: 1920, y: 0, width: 1600, height: 900 } };
const desktop = [primary, left, right];

function note(geometry = {}) { return { id: 100, content: 'keep me', hidden: false, pinned: false, ...geometry }; }
function box(obj) { return { x: obj.x, y: obj.y, width: obj.width, height: obj.height }; }

class MockWindow extends EventEmitter {
  constructor(bounds) { super(); this.bounds = { ...bounds }; this.dead = false; this.calls = []; }
  isDestroyed() { return this.dead; }
  getBounds() { return { ...this.bounds }; }
  setBounds(bounds) { this.calls.push({ ...bounds }); this.bounds = { ...bounds }; this.emit('moved'); this.emit('resized'); }
}
class MockScreen extends EventEmitter {
  constructor(displays) { super(); this.displays = displays; }
  getAllDisplays() { return this.displays; }
  getPrimaryDisplay() { return this.displays.find(x => x.primary) || primary; }
  setDisplays(displays, event = 'display-removed') { this.displays = displays; this.emit(event); }
}
function fixture(start, displays = desktop) {
  let stored = note(start);
  const writes = [];
  const screen = new MockScreen(displays);
  let now = 10000;
  let pending = null;
  const geometry = new NoteGeometry({
    screen, now: () => now,
    getNote: () => stored,
    persist: (id, patch) => { writes.push(patch); stored = { ...stored, ...patch }; },
    schedule: fn => { pending = fn; return 1; },
    cancel: () => { pending = null; },
  });
  const win = new MockWindow(geometry.initial(stored));
  geometry.track(win, stored.id);
  geometry.start();
  return { geometry, screen, win, writes, get: () => stored,
    advance: ms => { now += ms; },
    run: () => { const task = pending; pending = null; if (task) task(); },
  };
}

test('negative coordinates are valid when the left monitor exists', () => {
  const saved = note({ x: -1170, y: 40, w: 420, h: 320 });
  const result = planNoteBounds(saved, desktop);
  assert.equal(result.adjusted, false);
  assert.deepEqual(result.bounds, { x: -1170, y: 40, width: 420, height: 320 });
});

test('notes on a right monitor retain their saved position when connected', () => {
  assert.equal(planNoteBounds(note({ x: 2090, y: 85, w: 300, h: 360 }), desktop).bounds.x, 2090);
});

test('missing display relocates offscreen note within primary work area', () => {
  const result = planNoteBounds(note({ x: -1170, y: 60, w: 300, h: 360 }), [primary]);
  assert.equal(result.adjusted, true);
  assert.equal(result.bounds.x, 0);
  assert.equal(result.bounds.y, 60);
});

test('notes keep crossing a display seam when their titlebar is accessible', () => {
  const result = planNoteBounds(note({ x: -120, y: 50, w: 360, h: 300 }), desktop);
  assert.equal(result.adjusted, false);
  assert.equal(result.bounds.x, -120);
});

test('notes with inaccessible titlebar are recovered into view', () => {
  const result = planNoteBounds(note({ x: 1880, y: -600, w: 300, h: 360 }), [primary]);
  assert.equal(result.adjusted, true);
  assert.ok(result.bounds.x >= 0 && result.bounds.x + result.bounds.width <= 1920);
  assert.ok(result.bounds.y >= 0 && result.bounds.y + result.bounds.height <= 1040);
});

test('oversized note is visually capped without touching canonical width', () => {
  const saved = note({ x: 0, y: 0, w: 1100, h: 900 });
  const result = planNoteBounds(saved, [left]);
  assert.ok(result.bounds.height <= left.workArea.height);
  assert.ok(result.bounds.width <= left.workArea.width);
  assert.equal(saved.w, 1100);
});

test('new notes start inside the primary display work area with cascaded positions', () => {
  const a = planNoteBounds(note(), desktop, 0).bounds;
  const b = planNoteBounds(note(), desktop, 1).bounds;
  assert.equal(b.x - a.x, 28);
  assert.equal(b.y - a.y, 28);
});

test('screen controller explicitly selects primary display even when getAllDisplays lists left first', () => {
  const f = fixture({}, [left, primary]);
  assert.equal(f.win.bounds.x, 40);
  assert.equal(f.win.bounds.y, 40);
});

test('DIP placement is independent of the monitor pixel scale factor', () => {
  const d = { ...primary, scaleFactor: 2.5 };
  assert.deepEqual(planNoteBounds(note({ x: 250, y: 90, w: 360, h: 300 }), [d]).bounds,
    { x: 250, y: 90, width: 360, height: 300 });
});

test('unplug reflows visually without overwriting original saved coordinates', () => {
  const f = fixture({ x: -900, y: 80, w: 300, h: 360 });
  f.screen.setDisplays([primary]);
  f.run();
  assert.equal(f.win.bounds.x, 0);
  assert.equal(f.get().x, -900);
  assert.deepEqual(f.writes, []);
});

test('reconnecting original monitor restores note to its saved screen location', () => {
  const f = fixture({ x: -900, y: 80, w: 300, h: 360 });
  f.screen.setDisplays([primary]); f.run();
  f.screen.setDisplays(desktop, 'display-added'); f.run();
  assert.equal(f.win.bounds.x, -900);
  assert.deepEqual(f.writes, []);
});

test('manual drag on fallback monitor becomes the new preferred placement', () => {
  const f = fixture({ x: -900, y: 80, w: 300, h: 360 });
  f.screen.setDisplays([primary]); f.run();
  f.win.emit('will-move');
  f.win.bounds.x = 250;
  f.win.emit('moved');
  assert.equal(f.get().x, 250);
  f.screen.setDisplays(desktop, 'display-added'); f.run();
  assert.equal(f.win.bounds.x, 250);
});

test('manual resize writes dimensions, while topology correction does not', () => {
  const f = fixture({ x: 190, y: 130, w: 300, h: 360 });
  f.win.emit('will-resize');
  f.win.bounds.width = 530;
  f.win.emit('resized');
  assert.equal(f.get().w, 530);
  assert.equal(f.writes.length, 1);
});

test('native relocation during unplug without user gesture does not rewrite saved location', () => {
  const f = fixture({ x: -700, y: 80, w: 300, h: 360 });
  f.screen.setDisplays([primary]);
  f.win.bounds.x = 420;
  f.win.emit('moved');
  f.run();
  assert.equal(f.get().x, -700);
  assert.equal(f.win.bounds.x, 0);
});

test('repeated metrics events schedule one reflow and do not cause extra disk writes', () => {
  const f = fixture({ x: 100, y: 70, w: 300, h: 360 });
  f.screen.setDisplays([primary], 'display-metrics-changed');
  f.screen.setDisplays([primary], 'display-metrics-changed');
  f.run();
  assert.equal(f.win.calls.length, 0);
  assert.deepEqual(f.writes, []);
});

test('screen change after note closes never touches a destroyed window', () => {
  const f = fixture({ x: -900, y: 80, w: 300, h: 360 });
  f.win.dead = true; f.win.emit('closed');
  f.screen.setDisplays([primary]); f.run();
  assert.equal(f.win.calls.length, 0);
});

test('stopping geometry watcher removes display listeners', () => {
  const f = fixture({ x: 10, y: 20 });
  assert.equal(f.screen.listenerCount('display-added'), 1);
  f.geometry.stop();
  assert.equal(f.screen.listenerCount('display-added'), 0);
});

test('desktop owner integration and editor IPC remain unchanged', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /new DesktopLayer\(/);
  assert.match(main, /desktopLayer\.attach\(win\)/);
  assert.match(main, /noteGeometry\.track\(win, note\.id\)/);
  assert.match(main, /noteGeometry\.start\(\)/);
  assert.doesNotMatch(main, /getPrimaryDisplay\(\)\.workAreaSize/);
});
