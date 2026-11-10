'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { NoteLifecycle } = require('../src/windows/note-lifecycle');

function defer() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function makeWindow() {
  return {
    destroyed: false, visible: true, destroyedCount: 0, shown: 0, focused: 0,
    _userHide: true,
    isDestroyed() { return this.destroyed; },
    destroy() { this.destroyed = true; this.visible = false; this.destroyedCount++; },
    show() { this.shown++; this.visible = true; },
    focus() { this.focused++; },
  };
}

function harness(notes = [{ id: 1, hidden: false }]) {
  let data = notes.map(n => ({ ...n }));
  const wins = new Map();
  for (const note of data) {
    if (!note.hidden) wins.set(note.id, makeWindow());
  }
  let canPersist = true;
  let flushResult = true;
  let errors = 0;
  let unsaved = 0;
  let refreshes = 0;
  let opens = 0;
  const context = {
    getNote: id => data.find(n => n.id === id),
    listNotes: () => data,
    updateNote: (id, patch) => {
      if (!canPersist) return false;
      data = data.map(n => n.id === id ? { ...n, ...patch } : n);
      return true;
    },
    removeNote: id => {
      if (!canPersist) return false;
      data = data.filter(n => n.id !== id);
      return true;
    },
    getWindow: id => wins.get(id),
    openWindow: note => { opens++; wins.set(note.id, makeWindow()); },
    flushWindow: async () => typeof flushResult === 'function' ? flushResult() : flushResult,
    reportError: () => { errors++; },
    reportUnsaved: () => { unsaved++; },
    refresh: () => { refreshes++; },
  };
  return {
    lifecycle: new NoteLifecycle(context),
    get notes() { return data; },
    wins,
    get opens() { return opens; },
    get errors() { return errors; },
    get unsaved() { return unsaved; },
    get refreshes() { return refreshes; },
    setPersistence(value) { canPersist = value; },
    setFlush(value) { flushResult = value; },
  };
}

test('Hide persists hidden before destroying an open note', async () => {
  const h = harness();
  assert.equal(await h.lifecycle.hide(1), true);
  assert.equal(h.notes[0].hidden, true);
  assert.equal(h.wins.get(1).destroyedCount, 1);
});

test('Hide preserves open note on failed renderer flush', async () => {
  const h = harness();
  h.setFlush(false);
  assert.equal(await h.lifecycle.hide(1), false);
  assert.equal(h.notes[0].hidden, false);
  assert.equal(h.wins.get(1).destroyedCount, 0);
  assert.equal(h.unsaved, 1);
});

test('Hide preserves open note on failed disk write', async () => {
  const h = harness();
  h.setPersistence(false);
  assert.equal(await h.lifecycle.hide(1), false);
  assert.equal(h.notes[0].hidden, false);
  assert.equal(h.wins.get(1).destroyedCount, 0);
});

test('Show restores persisted visibility and creates a window if needed', async () => {
  const h = harness([{ id: 1, hidden: true }]);
  assert.equal(await h.lifecycle.show(1), true);
  assert.equal(h.notes[0].hidden, false);
  assert.equal(h.opens, 1);
});

test('Show existing note raises it without opening a duplicate', async () => {
  const h = harness();
  assert.equal(await h.lifecycle.show(1), true);
  assert.equal(h.opens, 0);
  assert.equal(h.wins.get(1).shown, 1);
  assert.equal(h.wins.get(1).focused, 1);
  assert.equal(h.wins.get(1)._userHide, false);
});

test('Show does not display hidden note if disk write fails', async () => {
  const h = harness([{ id: 1, hidden: true }]);
  h.setPersistence(false);
  assert.equal(await h.lifecycle.show(1), false);
  assert.equal(h.opens, 0);
  assert.equal(h.notes[0].hidden, true);
});

test('Repeated hide does not attempt to destroy a window twice', async () => {
  const h = harness();
  assert.equal(await h.lifecycle.hide(1), true);
  assert.equal(await h.lifecycle.hide(1), true);
  assert.equal(h.wins.get(1).destroyedCount, 1);
});

test('Delete persists removal then destroys the note window', async () => {
  const h = harness();
  assert.equal(await h.lifecycle.delete(1), true);
  assert.deepEqual(h.notes, []);
  assert.equal(h.wins.get(1).destroyedCount, 1);
});

test('Delete does not close a window on write failure', async () => {
  const h = harness();
  h.setPersistence(false);
  assert.equal(await h.lifecycle.delete(1), false);
  assert.equal(h.notes.length, 1);
  assert.equal(h.wins.get(1).destroyedCount, 0);
});

test('Delete and visibility operations ignore IDs that do not exist', async () => {
  const h = harness();
  assert.equal(await h.lifecycle.hide(999), false);
  assert.equal(await h.lifecycle.show(999), false);
  assert.equal(await h.lifecycle.delete(999), false);
  assert.equal(h.notes.length, 1);
});

test('Hide All persists each note and permits re-showing all notes', async () => {
  const h = harness([{ id: 1, hidden: false }, { id: 2, hidden: true }, { id: 3, hidden: false }]);
  assert.equal(await h.lifecycle.hideAll(), true);
  assert.ok(h.notes.every(n => n.hidden));
  assert.equal(await h.lifecycle.showAll(), true);
  assert.ok(h.notes.every(n => !n.hidden));
  assert.equal(h.opens, 3);
});

test('Hide All returns failure when one note cannot flush, leaving it available', async () => {
  const h = harness([{ id: 1, hidden: false }, { id: 2, hidden: false }]);
  let calls = 0;
  h.setFlush(() => ++calls !== 1);
  assert.equal(await h.lifecycle.hideAll(), false);
  assert.equal(h.notes[0].hidden, false);
  assert.equal(h.notes[1].hidden, true);
  assert.equal(h.wins.get(1).destroyedCount, 0);
});

test('Hide and Show requests are serialized per note', async () => {
  const h = harness();
  const gate = defer();
  h.setFlush(() => gate.promise);
  const hide = h.lifecycle.hide(1);
  const show = h.lifecycle.show(1);
  await Promise.resolve();
  assert.equal(h.notes[0].hidden, false);
  gate.resolve(true);
  assert.equal(await hide, true);
  assert.equal(await show, true);
  assert.equal(h.notes[0].hidden, false);
  assert.equal(h.opens, 1);
});

test('Delete issued during Hide runs after pending flush and does not resurrect note', async () => {
  const h = harness();
  const gate = defer();
  h.setFlush(() => gate.promise);
  const hide = h.lifecycle.hide(1);
  const del = h.lifecycle.delete(1);
  gate.resolve(true);
  await hide;
  assert.equal(await del, true);
  assert.deepEqual(h.notes, []);
});

test('whenIdle waits for an in-flight visibility operation', async () => {
  const h = harness();
  const gate = defer();
  h.setFlush(() => gate.promise);
  const hide = h.lifecycle.hide(1);
  let completed = false;
  const idle = h.lifecycle.whenIdle().then(() => { completed = true; });
  await Promise.resolve();
  assert.equal(completed, false);
  gate.resolve(true);
  await hide;
  await idle;
  assert.equal(completed, true);
});

test('Unexpected window errors are reported and queue continues', async () => {
  const h = harness();
  const win = h.wins.get(1);
  const original = win.destroy;
  win.destroy = () => { throw new Error('unexpected native error'); };
  assert.equal(await h.lifecycle.hide(1), false);
  assert.equal(h.errors, 1);
  win.destroy = original;
  assert.equal(await h.lifecycle.show(1), true);
});
