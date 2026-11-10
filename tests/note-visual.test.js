'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const html = () => read('note.html');
const main = () => read('main.js');

test('one cohesive note-shell uses a subtle 8px radius rather than 16px', () => {
  const page = html();
  assert.match(page, /--corner-radius:\s*8px/);
  assert.doesNotMatch(page, /--corner-radius:\s*16px/);
  assert.match(page, /#note-shell\s*\{[\s\S]*?border-radius:\s*var\(--corner-radius\)/);
  assert.match(page, /#note-shell\s*\{[\s\S]*?overflow:\s*hidden/);
  assert.ok(page.indexOf('<div id="note-shell">') < page.indexOf('id="titlebar"'));
  assert.ok(page.indexOf('id="statusbar"') < page.indexOf('</div><!-- #note-shell -->'));
});
test('no custom native window region interferes with Windows resize hit testing', () => {
  assert.doesNotMatch(main(), /setShape\(|installRoundedShape|note-window-shape/);
  assert.doesNotMatch(read('package.json'), /note-window-shape/);
  assert.equal(fs.existsSync(path.join(__dirname,'../src/windows/note-window-shape.js')),false);
});
test('native rounded corners are requested with regular resizable thick window frame', () => {
  const src=main();
  assert.match(src,/frame:\s*false, transparent:\s*false, roundedCorners:\s*true, thickFrame:\s*true/);
  assert.match(src,/resizable:\s*true/);
  assert.match(src,/minWidth:\s*280, minHeight:\s*320/);
  assert.doesNotMatch(src,/transparent:\s*true/);
});
test('body and note shell backgrounds match for all seven note colors', () => {
  const page=html(), renderer=read('src/renderer/note.js');
  assert.match(page,/body\s*\{[\s\S]*?background:\s*var\(--nc, #FFF9C4\)/);
  assert.match(page,/#note-shell\s*\{[\s\S]*?background:\s*var\(--nc, #FFF9C4\)/);
  assert.equal((renderer.match(/document\.body\.style\.background = noteColor/g)||[]).length,2);
  assert.equal((renderer.match(/getElementById\('note-shell'\)\.style\.background = noteColor/g)||[]).length,2);
  assert.equal((page.match(/class="cd"/g)||[]).length,7);
});
test('note controls, palette and editor structure remain available', () => {
  const page=html();
  for(const id of ['wb-pin','wb-close','wb-hide','wb-new','wb-dash','wb-toolbar','editor','toolbar','color-row','statusbar']) {
    assert.ok(page.includes(`id="${id}"`),id);
  }
  assert.match(page,/#wb-pin:hover/);
  assert.match(page,/#wb-pin\.pinned/);
  assert.match(page,/#editor\s*\{[\s\S]*?min-height:\s*0/);
  assert.match(page,/#editor\s*\{[\s\S]*?overflow-y:\s*auto/);
});
test('main process preserves desktop-layer ownership and native pin behavior', () => {
  const src=main();
  assert.match(src,/desktopLayer\.attach\(win\)/);
  assert.match(src,/noteGeometry\.track\(win, note\.id\)/);
  assert.match(src,/alwaysOnTop:\s*note\.pinned === true/);
  assert.match(src,/skipTaskbar:\s*true/);
});
test('editor and task controllers are unaffected by visual repair', () => {
  const src=read('src/renderer/note.js');
  for(const part of ['RaysNoteTasks.onTaskKeydown','RaysNoteTasks.serializedHTML','RaysNoteBullets.toggle','toggleNotePin','flushPendingSave']) {
    assert.ok(src.includes(part),part);
  }
});
test('the enlarged minimum is not written into the note JSON model', () => {
  const model=read('src/notes/note-model.js');
  assert.match(model,/\['w', 'h'\]/);
  assert.match(model,/200, 16384/);
  assert.doesNotMatch(main(),/note\.w\s*=\s*280/);
});
test('no untested native shape hooks, timer, or resize listener are introduced', () => {
  const src=main();
  assert.doesNotMatch(src,/setShape\(|win\.on\('resize',\s*scheduleApply\)/);
  assert.doesNotMatch(src,/setInterval\(/);
});
test('display changes and note close retain their lifecycle hooks', () => {
  const src=main();
  assert.match(src,/noteGeometry\.track\(win, note\.id\)/);
  assert.match(src,/win\.on\('closed'/);
  assert.match(src,/win\.on\('close'/);
  assert.match(src,/noteLifecycle\.hide\(note\.id\)/);
});
