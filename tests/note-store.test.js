'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { NoteStore, NoteStorageError } = require('../src/storage/note-store');

function withStore(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rays-note-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'notes.json');
  return { dir, file, store: new NoteStore(file) };
}

test('first launch with no notes file loads an empty collection', (t) => {
  const { file, store } = withStore(t);
  assert.deepEqual(store.load(), []);
  assert.equal(fs.existsSync(file), false);
});

test('existing notes load without migration or changes', (t) => {
  const { file, store } = withStore(t);
  const notes = [{ id: 100, content: '<b>مرحبا</b>', fontSize: 16, x: -100, unknownFutureField: true }];
  const bytes = JSON.stringify(notes);
  fs.writeFileSync(file, bytes);
  assert.deepEqual(store.load(), notes);
  assert.equal(fs.readFileSync(file, 'utf8'), bytes);
});

test('successful saves replace the collection without leaving temporary files', (t) => {
  const { dir, file, store } = withStore(t);
  store.save([{ id: 1, content: 'alpha' }]);
  store.save([{ id: 1, content: 'beta' }, { id: 2, content: 'saved' }]);
  assert.equal(store.load()[0].content, 'beta');
  assert.equal(fs.readdirSync(dir).length, 1);
  assert.equal(path.basename(file), fs.readdirSync(dir)[0]);
});

test('malformed JSON fails closed and is not replaced by an empty collection', (t) => {
  const { file, store } = withStore(t);
  const corrupted = '[{"id":12';
  fs.writeFileSync(file, corrupted);
  assert.throws(() => store.load(), NoteStorageError);
  assert.equal(fs.readFileSync(file, 'utf8'), corrupted);
});

test('invalid collection shape fails closed', (t) => {
  const { file, store } = withStore(t);
  for (const invalid of ['{}', '[null]', '[42]']) {
    fs.writeFileSync(file, invalid);
    assert.throws(() => store.load(), NoteStorageError);
    assert.equal(fs.readFileSync(file, 'utf8'), invalid);
  }
});

test('failed rename preserves the previous notes file and cleans up temporary data', (t) => {
  const { dir, file, store } = withStore(t);
  store.save([{ id: 1, content: 'original' }]);
  const before = fs.readFileSync(file, 'utf8');
  const failingIo = { ...fs, renameSync() { throw Object.assign(new Error('disk unavailable'), { code: 'EACCES' }); } };
  assert.throws(() => new NoteStore(file, failingIo).save([{ id: 1, content: 'new' }]), NoteStorageError);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.deepEqual(fs.readdirSync(dir), ['notes.json']);
});

test('failed fsync preserves the previous file and closes the staging handle', (t) => {
  const { dir, file, store } = withStore(t);
  store.save([{ id: 9, content: 'original' }]);
  const before = fs.readFileSync(file, 'utf8');
  const failingIo = { ...fs, fsyncSync() { throw new Error('sync failed'); } };
  assert.throws(() => new NoteStore(file, failingIo).save([{ id: 9, content: 'edited' }]), NoteStorageError);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.deepEqual(fs.readdirSync(dir), ['notes.json']);
});

test('stray temporary files are never treated as the actual notes file', (t) => {
  const { dir, file, store } = withStore(t);
  fs.writeFileSync(path.join(dir, '.notes.json.old.tmp'), '{broken');
  store.save([{ id: 1, content: 'current' }]);
  assert.equal(store.load()[0].content, 'current');
  assert.equal(fs.readFileSync(file, 'utf8').includes('current'), true);
});

test('renderer displays a save acknowledgment only after invoke succeeds', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'note.html'), 'utf8');
  assert.match(source, /ipcRenderer\.invoke\('note-update', payload\)/);
  assert.match(source, /reply\.ok !== true/);
  assert.match(source, /savedRevision = Math\.max/);
  assert.match(source, /flushPendingSave\(\)/);
});
