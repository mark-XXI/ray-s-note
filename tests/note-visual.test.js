'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const html = () => read('note.html');
const main = () => read('main.js');

// Match the enclosing <div> rather than relying on an exact optional comment.
// This remains meaningful after formatters change indentation or comments.
function noteShellMarkup(page) {
  const opening = /<div\b[^>]*\bid\s*=\s*(["'])note-shell\1[^>]*>/i.exec(page);
  assert.ok(opening, 'note-shell element must exist');
  const tag = /<\/?div\b[^>]*>/gi;
  tag.lastIndex = opening.index;
  let depth = 0;
  let match;
  while ((match = tag.exec(page))) {
    depth += /^<\s*\/div\b/i.test(match[0]) ? -1 : 1;
    assert.ok(depth >= 0, 'note-shell element nesting must remain valid');
    if (depth === 0) return page.slice(opening.index, tag.lastIndex);
  }
  assert.fail('note-shell closing div was not found');
}

function declaredBackground(page, selector) {
  const css = selector === 'body'
    ? /(?:^|\})\s*body\s*\{([^}]*)\}/m
    : /#note-shell\s*\{([^}]*)\}/m;
  const match = css.exec(page);
  assert.ok(match, `CSS rule missing: ${selector}`);
  const background = /(?:^|;)\s*background\s*:\s*var\(\s*--nc\s*,\s*(#[0-9a-f]{6})\s*\)/i.exec(match[1]);
  assert.ok(background, `expected note color CSS variable in ${selector}`);
  return background[1].toLowerCase();
}

test('one cohesive note-shell uses a subtle 8px radius rather than 16px', () => {
  const page = html();
  assert.match(page, /--corner-radius:\s*8px/);
  assert.doesNotMatch(page, /--corner-radius:\s*16px/);
  assert.match(page, /#note-shell\s*\{[\s\S]*?border-radius:\s*var\(--corner-radius\)/);
  assert.match(page, /#note-shell\s*\{[\s\S]*?overflow:\s*hidden/);
  const shell = noteShellMarkup(page);
  assert.match(shell, /id=["']titlebar["']/i);
  assert.match(shell, /id=["']statusbar["']/i);
  const titlePos = shell.search(/id\s*=\s*['"]titlebar['"]/i);
  const statusPos = shell.search(/id\s*=\s*['"]statusbar['"]/i);
  assert.ok(titlePos >= 0 && statusPos > titlePos,
    'title bar must precede status bar inside note-shell');
});
test('Electron setShape is absent; native rounding can release clipping during resize', () => {
  assert.doesNotMatch(main(), /setShape\(|installRoundedShape|note-window-shape/);
  assert.match(main(), /installNoteCorners/);
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
  assert.equal(declaredBackground(page, 'body'), '#fff9c4');
  assert.equal(declaredBackground(page, '#note-shell'), '#fff9c4');
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
test('no timer polling or old Electron region hooks are introduced', () => {
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
