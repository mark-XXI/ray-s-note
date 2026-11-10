'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  NoteValidationError, normalizeStoredNotes, allocateNoteId,
  createDefaultNote, applyNotePatch,
} = require('../src/notes/note-model');
const { NoteStore } = require('../src/storage/note-store');

const fixedDate = '2026-11-10T10:00:00.000Z';
const now = () => fixedDate;

function existing(overrides = {}) {
  return {
    id: 100, title: 'Project ideas', content: '<b>مرحبا</b>', color: '#C5E8FF', fontSize: 20,
    dir: 'rtl', pinned: true, hidden: false,
    createdAt: fixedDate, updatedAt: fixedDate,
    x: -1900, y: -300, w: 300, h: 360,
    unknownFutureField: { foo: true },
    ...overrides,
  };
}

test('current notes are unchanged, including custom fields and negative coordinates', () => {
  const note = existing();
  const [result] = normalizeStoredNotes([note], now);
  assert.deepEqual(result, note);
  assert.notEqual(result, note);
});

test('legacy notes missing optional fields are filled in memory without changing source', () => {
  const original = { id: 10, content: 'Old note', specialMetadata: ['a'] };
  const [value] = normalizeStoredNotes([original], now);
  assert.deepEqual(original, { id: 10, content: 'Old note', specialMetadata: ['a'] });
  assert.deepEqual(value, {
    ...original, title: '', color: '#FFF9C4', fontSize: 15, dir: 'rtl',
    pinned: false, hidden: false, createdAt: fixedDate, updatedAt: fixedDate,
  });
});

test('existing valid rich text and future metadata survive round-trip', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rays-note-model-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'notes.json');
  const original = [{ id: 50, content: '<i>ملاحظة</i>', newerVersionProperty: { nested: 1 } }];
  const raw = JSON.stringify(original);
  fs.writeFileSync(file, raw);
  const store = new NoteStore(file);
  const notes = normalizeStoredNotes(store.load(), now);
  assert.equal(fs.readFileSync(file, 'utf8'), raw, 'loading must not write to disk');
  store.save(notes);
  assert.equal(store.load()[0].content, original[0].content);
  assert.deepEqual(store.load()[0].newerVersionProperty, original[0].newerVersionProperty);
});

test('duplicate IDs refuse to load rather than hiding or merging a note', () => {
  assert.throws(() => normalizeStoredNotes([existing(), existing()], now),
    (error) => error instanceof NoteValidationError && /Duplicate note ID/.test(error.message));
});

test('missing and unsafe IDs fail closed', () => {
  for (const id of [undefined, null, '100', -1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const note = existing();
    if (id === undefined) delete note.id;
    else note.id = id;
    assert.throws(() => normalizeStoredNotes([note], now), NoteValidationError);
  }
});

test('invalid explicit note title, content or color is rejected, never replaced silently', () => {
  for (const overrides of [{ title: null }, { title: 'x'.repeat(81) }, { content: null }, { content: 23 },
    { color: 'red' }, { color: '#1234' }, { color: '<script>' }]) {
    assert.throws(() => normalizeStoredNotes([existing(overrides)], now), NoteValidationError);
  }
});

test('font and direction constraints reject malformed values', () => {
  for (const overrides of [{ fontSize: '15' }, { fontSize: 9 },
    { fontSize: 31 }, { fontSize: 14.5 }, { dir: 'auto' }]) {
    assert.throws(() => normalizeStoredNotes([existing(overrides)], now), NoteValidationError);
  }
});

test('geometry permits negative display coordinates but rejects invalid dimensions', () => {
  assert.equal(normalizeStoredNotes([existing({ x: -4000, y: -500 })], now)[0].x, -4000);
  for (const overrides of [{ x: '25' }, { y: 1.5 }, { w: 100 },
    { h: 200000 }, { w: null }]) {
    assert.throws(() => normalizeStoredNotes([existing(overrides)], now), NoteValidationError);
  }
});

test('boolean flags and timestamps reject malformed values', () => {
  for (const overrides of [{ hidden: 'false' }, { pinned: 1 },
    { createdAt: 'yesterday' }, { updatedAt: null }]) {
    assert.throws(() => normalizeStoredNotes([existing(overrides)], now), NoteValidationError);
  }
});

test('new note has stable numeric identifier and expected defaults', () => {
  const note = createDefaultNote(1234, now);
  assert.equal(note.id, 1234);
  assert.equal(note.title, '');
  assert.equal(note.content, '');
  assert.equal(note.dir, 'rtl');
  assert.equal(note.color, '#FFF9C4');
  assert.equal(note.fontSize, 15);
  assert.equal(note.createdAt, fixedDate);
});

test('new IDs skip occupied values without changing existing IDs', () => {
  const notes = [existing({ id: 100 }), existing({ id: 101 })];
  assert.equal(allocateNoteId(notes, () => 100), 102);
  assert.deepEqual(notes.map((note) => note.id), [100, 101]);
});

test('patches preserve unknown metadata without mutating input', () => {
  const old = existing();
  const next = applyNotePatch(old, { title: 'Updated title', content: '<b>Updated</b>', x: -100 }, now);
  assert.equal(next.title, 'Updated title');
  assert.equal(next.content, '<b>Updated</b>');
  assert.equal(next.x, -100);
  assert.deepEqual(next.unknownFutureField, { foo: true });
  assert.equal(old.content, '<b>مرحبا</b>');
  assert.equal(old.x, -1900);
});

test('patches cannot change identities, unexpected fields or corrupt existing data', () => {
  for (const patch of [{ id: 200 }, { createdAt: fixedDate },
    { unexpected: true }, { title: 9 }, { content: undefined }, { color: '#bad' },
    { hidden: 'yes' }, { fontSize: 2 }, { w: 0 }]) {
    assert.throws(() => applyNotePatch(existing(), patch, now), NoteValidationError);
  }
});

test('model and main process are wired without bypassing validation', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /normalizeStoredNotes\(noteStore\.load\(\)\)/);
  assert.match(main, /normalizeStoredNotes\(nextNotes\)/);
  assert.match(main, /applyNotePatch\((?:note|current),/);
  assert.match(main, /allocateNoteId\(allNotes\)/);
});
