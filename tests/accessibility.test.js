'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
function loadKeys() {
  const sandbox = { window: {} };
  vm.runInNewContext(read('src/renderer/keyboard.js'), sandbox);
  return sandbox.window.RaysNoteKeys;
}
function key(name, options = {}) {
  return {
    key: name, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
    isComposing: false, defaultPrevented: false, target: null, prevented: false,
    preventDefault() { this.prevented = true; }, ...options,
  };
}
test('keyboard module exposes only note and dashboard dispatchers', () => {
  assert.deepEqual(Object.keys(loadKeys()).sort(), ['dashboard','note']);
});
test('Ctrl+N creates notes from both windows and prevents default behavior', () => {
  const k = loadKeys(); let count=0;
  for (const handler of [k.note, k.dashboard]) {
    const e=key('n',{ctrlKey:true});
    assert.equal(handler(e,{create:()=>{count++;}}),true);
    assert.equal(e.prevented,true);
  }
  assert.equal(count,2);
});
test('standard editor Ctrl+B/I/U and plain Enter are never intercepted', () => {
  const k=loadKeys();
  for (const name of ['b','i','u','Enter']) {
    const e=key(name,{ctrlKey:name!=='Enter'});
    assert.equal(k.note(e,{}),false);
    assert.equal(e.prevented,false);
  }
});
test('note Ctrl+S flushes, Ctrl+Shift+D opens dashboard, Ctrl+Shift+T toggles toolbar',()=>{
  const k=loadKeys(); const calls=[];
  const actions={save:()=>calls.push('save'),dashboard:()=>calls.push('dashboard'),toolbar:()=>calls.push('toolbar')};
  for (const [name,shift] of [['s',false],['d',true],['t',true]]) {
    const e=key(name,{ctrlKey:true,shiftKey:shift});
    assert.equal(k.note(e,actions),true);
  }
  assert.deepEqual(calls,['save','dashboard','toolbar']);
});
test('Escape dismisses note toolbar only when an escape handler is present',()=>{
  const k=loadKeys(), e=key('Escape');
  assert.equal(k.note(e,{}),false);
  assert.equal(e.prevented,false);
  let called=false;
  assert.equal(k.note(e,{escape:()=>called=true}),true);
  assert.equal(called,true);
});
test('dashboard Ctrl+F and slash search; slash never intercepts editable text',()=>{
  const k=loadKeys(); let searches=0;
  const search=()=>searches++;
  assert.equal(k.dashboard(key('f',{ctrlKey:true}),{search}),true);
  assert.equal(k.dashboard(key('/',{target:{closest:()=>null}}),{search}),true);
  const e=key('/',{target:{closest:()=>({})}});
  assert.equal(k.dashboard(e,{search}),false);
  assert.equal(e.prevented,false);
  assert.equal(searches,2);
});
test('dashboard Escape only clears while search input has focus',()=>{
  const k=loadKeys();let clears=0;
  assert.equal(k.dashboard(key('Escape',{target:{id:'search-input'}}),{clearSearch:()=>clears++}),true);
  assert.equal(k.dashboard(key('Escape',{target:{id:'notes-wrap'}}),{clearSearch:()=>clears++}),false);
  assert.equal(clears,1);
});
test('composition, already-handled events and unrelated modifier chords are ignored',()=>{
  const k=loadKeys();let calls=0;
  for(const options of [{isComposing:true},{defaultPrevented:true},{altKey:true},{shiftKey:true}]) {
    const e=key('n',{ctrlKey:true,...options});
    assert.equal(k.note(e,{create:()=>calls++}),false);
  }
  assert.equal(calls,0);
});
test('color controls are semantic buttons with keyboard click and pressed states',()=>{
  const page=read('note.html'), src=read('src/renderer/note.js');
  assert.equal((page.match(/<button type="button" class="cd"/g)||[]).length,7);
  assert.match(page,/id="color-row" role="group" aria-label="Note colors"/);
  assert.match(src,/d\.setAttribute\('aria-pressed', String\(active\)\)/);
  assert.match(src,/dot\.dataset\.c/);
});
test('editor, status and formatting toolbar are accessible to assistive technology',()=>{
  const page=read('note.html');
  assert.match(page,/role="textbox" aria-label="Note content" aria-multiline="true"/);
  assert.match(page,/id="save-lbl" role="status" aria-live="polite"/);
  assert.match(page,/id="toolbar" role="toolbar" aria-label="Note formatting"/);
  assert.match(page,/id="wb-toolbar"[^>]+aria-expanded="false"/);
  assert.match(read('src/renderer/note.js'),/setAttribute\('aria-expanded', String\(toolbarVisible\)\)/);
});
test('dashboard filters expose pressed state and the note list is labeled',()=>{
  const page=read('dashboard.html'), src=read('src/renderer/dashboard.js');
  assert.match(page,/id="filter-bar" role="group" aria-label="Filter notes"/);
  assert.match(page,/id="notes-wrap" role="region" aria-label="Notes list"/);
  assert.match(page,/id="search-count"[^>]+role="status" aria-live="polite"/);
  assert.match(src,/b\.setAttribute\('aria-pressed', String\(selected\)\)/);
});
test('dashboard card actions describe the note without injecting HTML',()=>{
  const src=read('src/renderer/dashboard.js');
  assert.match(src,/card\.setAttribute\('role', 'group'\)/);
  assert.match(src,/setAttribute\('aria-label', `\$\{button\.textContent/);
  assert.match(src,/querySelector\('\.note-title'\)\.textContent = title/);
  assert.match(src,/querySelector\('\.note-preview'\)\.textContent = preview/);
  assert.match(src,/const activeButton = document\.activeElement/);
  assert.match(src,/focusTarget\?\.focus\(\)/);
});
test('both renderers use isolated keyboard module and support reduced motion',()=>{
  const note=read('note.html'),dashboard=read('dashboard.html');
  assert.ok(note.indexOf('src/renderer/keyboard.js')<note.indexOf('src/renderer/note.js'));
  assert.ok(dashboard.indexOf('src/renderer/keyboard.js')<dashboard.indexOf('src/renderer/dashboard.js'));
  assert.match(note,/prefers-reduced-motion/);
  assert.match(dashboard,/prefers-reduced-motion/);
});
test('security, desktop ownership and editor controllers remain separate',()=>{
  const main=read('main.js');
  assert.match(main,/desktopLayer\.attach\(win\)/);
  assert.match(main,/installNoteCorners/);
  assert.match(main,/noteGeometry\.track/);
  assert.match(read('src/renderer/note.js'),/RaysNoteTasks\.serializedHTML/);
  assert.match(read('src/renderer/note.js'),/RaysNoteBullets\.toggle/);
});
