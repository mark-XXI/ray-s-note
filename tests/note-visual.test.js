'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const { RADIUS, roundedRects, installRoundedShape } = require('../src/windows/note-window-shape');
const { EventEmitter } = require('node:events');

function covers(rects, x, y) {
  return rects.some(r => x >= r.x && x < r.x+r.width && y >= r.y && y < r.y+r.height);
}
test('note uses a single rounded 16px shell containing all existing controls', () => {
  const html = read('note.html');
  assert.match(html, /--corner-radius:\s*16px/);
  assert.match(html, /#note-shell\s*\{/);
  assert.match(html, /border-radius:\s*var\(--corner-radius\)/);
  assert.match(html, /overflow:\s*hidden/);
  assert.ok(html.indexOf('<div id="note-shell">') < html.indexOf('<div id="titlebar">'));
  assert.ok(html.indexOf('id="statusbar"') < html.indexOf('</div><!-- #note-shell -->'));
  for (const name of ['wb-pin','wb-close','wb-hide','wb-new','wb-dash','wb-toolbar','editor','toolbar','color-row']) {
    assert.ok(html.includes(`id="${name}"`), name);
  }
});
test('note color applies to the rounded surface while shell remains opaque', () => {
  const note = read('src/renderer/note.js');
  assert.equal((note.match(/getElementById\('note-shell'\)\.style\.background = noteColor/g)||[]).length,2);
  assert.doesNotMatch(note, /document\.body\.style\.background = noteColor/);
  assert.match(read('main.js'), /frame: false, transparent: false, roundedCorners: true/);
});
test('existing rich text, tasks, pinning and desktop attachment code is untouched', () => {
  const note = read('src/renderer/note.js');
  for (const part of ['RaysNoteTasks.onTaskKeydown', 'RaysNoteTasks.serializedHTML', 'RaysNoteBullets.toggle', 'toggleNotePin', 'flushPendingSave']) assert.ok(note.includes(part), part);
  const main = read('main.js');
  assert.match(main, /desktopLayer\.attach\(win\)/);
  assert.match(main, /noteGeometry\.track\(win, note\.id\)/);
  assert.match(main, /installRoundedShape\(win/);
});
test('rounding region covers center and excludes the four 16px corners', () => {
  assert.equal(RADIUS, 16);
  const rects = roundedRects(300,360);
  assert.ok(rects.length <= 33);
  for (const [x,y] of [[150,150],[16,0],[0,16],[299,16],[16,359],[150,0]]) {
    assert.ok(covers(rects,x,y), `missing ${x},${y}`);
  }
  for (const [x,y] of [[0,0],[299,0],[0,359],[299,359]]) {
    assert.equal(covers(rects,x,y), false, `corner ${x},${y} not clipped`);
  }
});
test('rounding shape scales to resize dimensions and handles invalid geometry', () => {
  for (const [w,h] of [[200,200],[460,620],[24,24],[1,1]]) {
    const rects=roundedRects(w,h);
    assert.ok(rects.length>0);
    for (const r of rects) {
      assert.ok(r.x>=0 && r.y>=0 && r.width>0 && r.height>0);
      assert.ok(r.x+r.width<=w && r.y+r.height<=h);
    }
  }
  assert.deepEqual(roundedRects(0,300),[]);
  assert.deepEqual(roundedRects(NaN,300),[]);
});
class FakeWindow extends EventEmitter {
  constructor(){super();this.size=[300,360];this.calls=[];this.dead=false;}
  setShape(rects){this.calls.push(rects);}
  getContentSize(){return this.size;}
  isDestroyed(){return this.dead;}
}
test('window shape uses native optional API without changing resizable mode', () => {
  const win=new FakeWindow();
  assert.equal(installRoundedShape(win,{platform:'win32'}),true);
  win.emit('ready-to-show');
  assert.equal(win.calls.length,1);
  assert.equal(covers(win.calls[0],0,0),false);
  assert.match(read('main.js'), /resizable: true/);
});
test('resizes are debounced and do not change note geometry data', () => {
  const win=new FakeWindow(); const jobs = new Map();let id=0;
  const schedule=cb=>{jobs.set(++id,cb);return id;};const cancel=k=>jobs.delete(k);
  installRoundedShape(win,{platform:'win32',schedule,cancel});win.emit('ready-to-show');
  win.size=[350,410]; win.emit('resize');win.emit('resize');win.emit('resized');
  assert.equal(jobs.size,1);
  for (const fn of jobs.values()) fn();jobs.clear();
  assert.equal(win.calls.length,2);
  assert.ok(covers(win.calls.at(-1),175,400));
  win.emit('resize'); for (const fn of jobs.values())fn();jobs.clear();
  assert.equal(win.calls.length,2,'no unnecessary native rewrite for unchanged dimensions');
});
test('closed windows cancel pending updates without accessing dead HWND', () => {
  const win=new FakeWindow();let cancelled=0;const callbacks=[];
  installRoundedShape(win,{platform:'win32',schedule:fn=>{callbacks.push(fn);return callbacks.length;},cancel:()=>cancelled++});
  win.emit('ready-to-show');win.emit('resize');win.dead=true;win.emit('closed');
  assert.equal(cancelled,1);
  callbacks[0]();assert.equal(win.calls.length,1);
});
test('unsupported platforms and failed native calls leave note window usable', () => {
  const win=new FakeWindow();
  assert.equal(installRoundedShape(win,{platform:'linux'}),false);
  assert.equal(win.listenerCount('resize'),0);
  let warnings=0;
  const broken=new FakeWindow();broken.setShape=()=>{throw new Error('native not available')};
  installRoundedShape(broken,{platform:'win32',warn:()=>warnings++});
  assert.doesNotThrow(()=>broken.emit('ready-to-show'));
  assert.equal(warnings,1);
});
test('color chips, compact toolbar and preserved grey hover pin remain styled', () => {
  const html=read('note.html');
  assert.match(html, /#wb-pin:hover/);
  assert.match(html, /#wb-pin\.pinned/);
  assert.match(html, /\.cd\.on/);
  assert.match(html, /\.tb:focus-visible/);
  assert.match(html, /#editor\s*\{[\s\S]*?min-height: 0/);
});
