'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const tasks = read('src/renderer/note-tasks.js');
const note = read('src/renderer/note.js');
const sanitizer = read('src/renderer/note-html.js');
const html = read('note.html');

test('task controller loads before the note renderer', () => {
  assert.ok(html.indexOf('src/renderer/note-tasks.js') < html.indexOf('src/renderer/note.js'));
  assert.match(tasks, /Object\.freeze\(\{ normalize, insertAtSelection, onCheckboxChange, onTaskKeydown, serializedHTML \}\)/);
});
test('task container is not editable but label is an editable child', () => {
  assert.match(tasks, /row\.setAttribute\('contenteditable', 'false'\)/);
  assert.match(tasks, /label\.setAttribute\('contenteditable', 'true'\)/);
  assert.match(sanitizer, /clean\.setAttribute\('contenteditable', 'false'\)/);
});
test('checkbox property is serialized explicitly even after changing it', () => {
  assert.match(tasks, /source\.checked/);
  assert.match(tasks, /cb\.setAttribute\('checked', ''\)/);
  assert.match(tasks, /cb\.removeAttribute\('checked'\)/);
  assert.match(note, /RaysNoteTasks\.serializedHTML\(editor\)/);
});
test('checkbox actions are delegated to editor and schedule persistence', () => {
  assert.match(note, /editor\.addEventListener\('change', event/);
  assert.match(note, /RaysNoteTasks\.onCheckboxChange\(event, editor\)/);
  assert.match(tasks, /label\.classList\.toggle\('done', checkbox\.checked\)/);
});
test('Enter creates another task or leaves the checklist when blank', () => {
  assert.match(tasks, /event\.key === 'Enter'/);
  assert.match(tasks, /row\.after\(next\)/);
  assert.match(tasks, /row\.after\(p\)/);
});
test('Backspace on an empty task safely deletes the row', () => {
  assert.match(tasks, /event\.key === 'Backspace'/);
  assert.match(tasks, /row\.remove\(\)/);
  assert.match(tasks, /focusText\(previous, true\)/);
});
test('new and restored tasks share one normalization path', () => {
  assert.match(note, /RaysNoteTasks\.normalize\(editor\)/);
  assert.match(tasks, /editor\.querySelectorAll\('\.task-row'\)/);
  assert.doesNotMatch(note, /addEventListener\('change'.*?toggleTask/s);
});
test('task visuals respect RTL and use accessible label focus state', () => {
  assert.match(html, /direction: inherit/);
  assert.match(html, /\.task-text:empty::before/);
  assert.match(html, /\.task-text:focus-visible/);
  assert.match(tasks, /setAttribute\('aria-label', 'Complete task'\)/);
});
test('toolbar interaction preserves selection before formatting', () => {
  assert.match(note, /toolbar'\)\.addEventListener\('mousedown'/);
  assert.match(note, /event\.preventDefault\(\)/);
  assert.match(note, /function preserveSelectionFocus/);
  assert.match(note, /RaysNoteBullets\.toggle\(editor, window\.getSelection\(\)\)/);
});
test('security policy continues to sanitize HTML prior to save', () => {
  assert.match(note, /RaysNoteHtml\.sanitize\(window\.RaysNoteTasks\.serializedHTML\(editor\)\)/);
  assert.match(sanitizer, /blocked\.has\(tag\)/);
  assert.doesNotMatch(note, /ipcRenderer|require\('electron'\)/);
});

test('Shift+Enter creates a multiline task without altering Enter row creation', () => {
  assert.match(tasks, /event\.shiftKey/);
  assert.match(tasks, /insertTaskLineBreak\(node\)/);
  assert.match(tasks, /createTextNode\(atEnd \?/);
  assert.match(tasks, /row\.after\(next\)/);
  assert.match(html, /white-space: pre-wrap/);
});
test('bullet controller loads before note and removes unreliable native list command', () => {
  const bullets = read('src/renderer/note-bullets.js');
  assert.ok(html.indexOf('src/renderer/note-bullets.js') < html.indexOf('src/renderer/note.js'));
  assert.match(note, /RaysNoteBullets\.toggle\(editor, window\.getSelection\(\)\)/);
  assert.doesNotMatch(note, /insertUnorderedList/);
  assert.match(bullets, /list\.replaceWith\(fragment\)/);
});
test('bullet lists and task checkboxes are still sanitizer allowlisted', () => {
  assert.match(sanitizer, /'ul', 'ol', 'li'/);
  assert.match(sanitizer, /'task-row', 'task-text', 'done'/);
  assert.match(note, /RaysNoteHtml\.sanitize\(window\.RaysNoteTasks\.serializedHTML\(editor\)\)/);
});

test('bullet insertion preserves selected paragraphs and never converts tasks', () => {
  const bullets = read('src/renderer/note-bullets.js');
  assert.match(bullets, /function selectedBlocks\(editor, selection\)/);
  assert.match(bullets, /blocks\.forEach\(\(block, index\)/);
  assert.match(bullets, /target\.classList\.contains\('task-row'\)/);
  assert.match(bullets, /target\.after\(list\)/);
});
test('multiline task line break accounts for Chromium trailing-caret placement', () => {
  assert.match(tasks, /const atEnd = remainder\.toString\(\)\.length === 0/);
  assert.match(tasks, /atEnd \? '\\n\\n' : '\\n'/);
  assert.match(tasks, /range\.setStart\(newline, 1\)/);
  assert.match(tasks, /event\.preventDefault\(\)/);
});
