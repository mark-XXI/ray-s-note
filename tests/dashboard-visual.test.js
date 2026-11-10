'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const html = read('dashboard.html'); const renderer=read('src/renderer/dashboard.js');

test('dashboard keeps all existing renderer targets and management actions',()=>{
  for(const id of ['header','btn-new-dash','stats','st-total','st-open','st-hidden','st-pinned',
    'filter-bar','search-row','search-input','notes-wrap','footer']) assert.ok(html.includes(`id="${id}"`),id);
  for(const a of ['show','hide','pin','delete']) assert.ok(renderer.includes(`data-action="${a}"`),a);
  assert.match(renderer,/dashboardAPI\.requestNotes\(\)/);
});
test('dashboard preserves dark palette and readable note cards',()=>{
  assert.match(html,/--bg:\s*#1e1e2e/);
  assert.match(html,/--accent:\s*#7c6fff/);
  assert.match(html,/#notes-wrap\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(html,/\.note-card\s*\{[^}]*grid-template-columns:/);
  assert.match(html,/\.note-actions\s*\{[^}]*grid-column:\s*2/);
});
test('dashboard works at smaller width and keyboard focus is visible',()=>{
  assert.match(html,/@media\s*\(max-width:\s*430px\)/);
  assert.match(html,/button:focus-visible/);
  assert.match(html,/#search-input:focus/);
});
test('unsafe HTML never becomes executable note preview content',()=>{
  assert.match(renderer,/querySelector\('\.note-preview'\)\.textContent\s*=/);
  assert.match(renderer,/wrap\.addEventListener\('click'|getElementById\('notes-wrap'\)\.addEventListener\('click'/);
});
