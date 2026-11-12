'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { installNoteCorners, RADIUS_DIP } = require('../src/windows/note-corners');

function fixture({ failApply = false, failClear = false } = {}) {
  const win = new EventEmitter(); win.isDestroyed = () => false;
  const calls = []; let warning;
  const pending = new Map(); let token = 0;
  const schedule = fn => { const id = ++token; pending.set(id,fn); return id; };
  const cancel = id => pending.delete(id);
  const runPending = () => { const list = [...pending.values()]; pending.clear(); list.forEach(fn=>fn()); };
  const adapter = {
    apply(_win, radius) { calls.push(`apply:${radius}`); return !failApply; },
    clear() { calls.push('clear'); return !failClear; },
  };
  const control = installNoteCorners(win, { adapter, schedule, cancel, warn: e => warning = e });
  return { win, calls, control, runPending, pending, get warning() { return warning; } };
}

test('rounded region uses subtle 8 DIP radius and applies once at display',()=>{
  const f=fixture(); f.control.apply(); assert.deepEqual(f.calls,[`apply:${RADIUS_DIP}`]);
  assert.equal(RADIUS_DIP,8);
});
test('manual resize clears native region first and does not reapply while dragging',()=>{
  const f=fixture(); f.control.apply(); f.win.emit('will-resize');
  f.win.emit('resize'); f.win.emit('resize');
  assert.deepEqual(f.calls,['apply:8','clear']);
  assert.equal(f.pending.size,0);
  f.win.emit('resized'); assert.deepEqual(f.calls,['apply:8','clear','apply:8']);
  assert.equal(f.pending.size,0);
});
test('manual resize is never re-clipped before native resized event',()=>{
  const f=fixture(); f.win.emit('will-resize'); f.win.emit('resize');
  f.runPending(); assert.deepEqual(f.calls,['clear']);
  f.win.emit('resized'); assert.deepEqual(f.calls,['clear','apply:8']);
});
test('programmatic size change re-applies once on settled resize',()=>{
  const f=fixture(); f.win.emit('resize'); f.win.emit('resize');
  assert.deepEqual(f.calls,[]); f.runPending(); assert.deepEqual(f.calls,['apply:8']);
});
test('on native error the controller fails open and will not continually retry',()=>{
  const f=fixture({ failApply:true }); f.control.apply();
  assert.equal(f.warning?.message,'Rounded region unavailable');
  f.win.emit('will-resize'); f.win.emit('resized');
  assert.deepEqual(f.calls,['apply:8','clear']);
});
test('on failure to clear before resize the controller disables itself',()=>{
  const f=fixture({ failClear:true }); f.control.apply(); f.win.emit('will-resize');
  assert.match(f.warning.message,/clear region/); f.win.emit('resized');
  assert.deepEqual(f.calls,['apply:8','clear','clear']);
});
test('closed window cancels region timers and unregisters event listeners',()=>{
  const f=fixture(); f.win.emit('resize'); assert.equal(f.pending.size,1);
  f.win.emit('closed'); f.runPending(); assert.deepEqual(f.calls,[]);
  assert.equal(f.win.listenerCount('will-resize'),0);
  assert.equal(f.win.listenerCount('resize'),0);
  assert.equal(f.win.listenerCount('resized'),0);
});
test('unsupported adapter changes no native window state',()=>{
  const win = new EventEmitter(); const c=installNoteCorners(win, { adapter:null });
  assert.equal(c.supported,false); assert.equal(win.listenerCount('resize'),0);
});
test('source uses Windows GDI region rather than Electron setShape or window transparency',()=>{
  const fs = require('node:fs'); const path = require('node:path');
  const main=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');
  const native=fs.readFileSync(path.join(__dirname,'../src/windows/note-corners.js'),'utf8');
  assert.match(native,/CreateRoundRectRgn/); assert.match(native,/SetWindowRgn/);
  assert.match(native,/GetWindowRect/); assert.match(native,/GetDpiForWindow/);
  assert.match(main,/installNoteCorners/);
  assert.match(main,/resizable:\s*true/); assert.match(main,/thickFrame:\s*true/);
  assert.doesNotMatch(main,/setShape\(|transparent:\s*true/);
});
