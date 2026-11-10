'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DashboardRefresh } = require('../src/performance/dashboard-refresh');
const { editorFieldsChanged, patchFieldsChanged } = require('../src/performance/note-diff');
const { applyNotePatch } = require('../src/notes/note-model');
const { NoteStore } = require('../src/storage/note-store');
const os = require('node:os');

function clock() {
  let nextId = 0;
  const jobs = new Map();
  return {
    schedule(fn) { const id = ++nextId; jobs.set(id, fn); return id; },
    cancel(id) { jobs.delete(id); },
    tick() { const pending = [...jobs.values()]; jobs.clear(); pending.forEach(fn => fn()); },
    count() { return jobs.size; },
  };
}

function controller(activeInitially = true) {
  const tasks = clock();
  let active = activeInitially;
  let sends = 0;
  const refresh = new DashboardRefresh({
    send: () => { sends++; }, isActive: () => active,
    schedule: fn => tasks.schedule(fn), cancel: id => tasks.cancel(id),
  });
  return { refresh, tasks, sent: () => sends, active: v => { active = v; } };
}

const original = {
  id: 1, title: 'Hello', content: '<b>hello</b>', color: '#FFF9C4', fontSize: 15, dir: 'rtl',
  hidden: false, pinned: false, createdAt: '2026-11-10T10:00:00.000Z',
  updatedAt: '2026-11-10T10:00:00.000Z',
};
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('hundreds of rapid dashboard refresh requests schedule only one delivery', () => {
  const { refresh, tasks, sent } = controller();
  for (let i=0; i<500; i++) refresh.request();
  assert.equal(tasks.count(), 1);
  tasks.tick();
  assert.equal(sent(), 1);
});
test('later dashboard changes still update after the first burst settles', () => {
  const { refresh, tasks, sent } = controller();
  refresh.request(); tasks.tick(); refresh.request(); tasks.tick();
  assert.equal(sent(), 2);
});
test('refresh request skips dashboards that are closed or not visible', () => {
  const { refresh, tasks, sent, active } = controller(false);
  refresh.request(); assert.equal(tasks.count(),0);
  active(true); refresh.request(); tasks.tick(); assert.equal(sent(),1);
});
test('refresh due after dashboard closed performs no send', () => {
  const { refresh, tasks, sent, active } = controller();
  refresh.request(); active(false); tasks.tick(); assert.equal(sent(),0);
});
test('showing dashboard flushes pending changes immediately and once', () => {
  const { refresh, tasks, sent } = controller();
  refresh.request();
  assert.equal(refresh.flush({force:true}), true);
  assert.equal(sent(),1); assert.equal(tasks.count(),0);
  tasks.tick(); assert.equal(sent(),1);
});
test('fresh dashboard can force its initial full snapshot without pending work', () => {
  const { refresh, sent } = controller();
  assert.equal(refresh.flush({force:true}),true);
  assert.equal(sent(),1);
});
test('closing dashboard discards pending timers', () => {
  const { refresh, tasks, sent } = controller();
  refresh.request(); refresh.discard(); tasks.tick();
  assert.equal(sent(),0);
});
test('shutdown stops all pending dashboard work permanently', () => {
  const { refresh, tasks, sent } = controller();
  refresh.request(); refresh.stop(); refresh.request();
  tasks.tick(); assert.equal(sent(),0); assert.equal(tasks.count(),0);
});
test('dashboard scheduler requires both send and visibility callbacks', () => {
  assert.throws(() => new DashboardRefresh({send:()=>{}}), TypeError);
  assert.throws(() => new DashboardRefresh({isActive:()=>true}), TypeError);
});
test('unchanged editor values are recognized even if timestamp differs', () => {
  const updated = applyNotePatch(original, { updatedAt: '2026-11-10T11:00:00.000Z' });
  assert.equal(editorFieldsChanged(original, updated), false);
});
test('every editor-owned field is detected when changed', () => {
  for (const [key, value] of [
    ['title', 'Another title'], ['content', 'another'], ['color', '#ABCDEF'], ['fontSize', 16], ['dir', 'ltr'],
  ]) {
    const updated = applyNotePatch(original, { [key]: value });
    assert.equal(editorFieldsChanged(original, updated), true, key);
  }
});
test('unchanged pin/geometry patches do not require another disk write', () => {
  for (const patch of [{hidden:false},{pinned:false},{content:original.content},{}]) {
    const updated = applyNotePatch(original, patch);
    assert.equal(patchFieldsChanged(original, updated, patch),false);
  }
});
test('real note geometry and visibility changes remain persistent changes', () => {
  for (const patch of [{hidden:true},{pinned:true},{x:-700},{w:320},{h:380}]) {
    const updated = applyNotePatch(original, patch);
    assert.equal(patchFieldsChanged(original, updated, patch),true);
  }
});
test('invalid note updates are still rejected before no-op optimization', () => {
  assert.throws(() => applyNotePatch(original, {fontSize:'15'}));
  assert.throws(() => applyNotePatch(original, {secret:'bad'}));
});
test('real changes still use atomic NoteStore writes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rays-perf-'));
  try {
    const file = path.join(dir,'notes.json');
    const store = new NoteStore(file);
    const updated = applyNotePatch(original, {content:'new'});
    assert.equal(editorFieldsChanged(original,updated),true);
    store.save([updated]);
    assert.equal(store.load()[0].content,'new');
    assert.deepEqual(fs.readdirSync(dir), ['notes.json']);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
test('main process skips no-op writes after patch validation and before commit', () => {
  const source = read('main.js');
  assert.match(source, /applyNotePatch\(current,\s*\{/);
  assert.match(source, /if \(!editorFieldsChanged\(current, updated\)\) return \{ ok: true \};/);
  assert.match(source, /if \(!patchFieldsChanged\(current, updated, patch\)\) return true;/);
  assert.match(source, /noteStore\.save\(checkedNotes\);[\s\S]*?allNotes = checkedNotes;[\s\S]*?notesById = new Map/);
  assert.match(source, /notesById = new Map\(allNotes\.map/);
});
test('dashboard updates are coalesced without delaying storage or breaking IPC', () => {
  const source = read('main.js');
  assert.match(source, /function refreshDash\(\) \{ dashboardRefresh\.request\(\); \}/);
  assert.match(source, /dashWin\.on\('show', \(\) => \{ dashboardRefresh\.flush\(\{ force: true \}\); \}\);/);
  assert.match(source, /dashWin\.on\('restore', \(\) => \{ dashboardRefresh\.flush\(\{ force: true \}\); \}\);/);
  assert.match(source, /dashboardRefresh\.stop\(\)/);
  assert.match(source, /ipcMain\.handle\('note-update'/);
  assert.match(source, /new DesktopLayer\(/);
  assert.match(source, /installNoteCorners\(/);
});
