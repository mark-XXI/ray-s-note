'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const html = read('dashboard.html');
const renderer = read('src/renderer/dashboard.js');

test('dashboard preserves all management controls and renderer hooks', () => {
  for (const id of ['header', 'btn-new-dash', 'stats', 'st-total', 'st-open', 'st-hidden', 'st-pinned',
    'filter-bar', 'search-row', 'search-input', 'search-count', 'notes-wrap', 'footer']) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
  for (const action of ['show', 'hide', 'pin', 'delete']) {
    assert.ok(renderer.includes(`data-action="${action}"`), action);
  }
  for (const handler of ['renderList', 'updateStats', 'setFilter', 'deleteNote', 'newNote']) {
    assert.ok(renderer.includes(`function ${handler}(`), handler);
  }
  assert.match(renderer, /dashboardAPI\.requestNotes\(\)/);
});

test('dashboard has distinct accessible light and dark design tokens', () => {
  assert.match(html, /:root\s*\{[^}]*color-scheme:\s*light;/);
  assert.match(html, /@media\s*\(prefers-color-scheme:\s*dark\)/);
  assert.match(html, /:root:not\(\[data-theme="light"\]\)/);
  assert.match(html, /:root\[data-theme="dark"\]/);
  assert.match(html, /--accent:\s*#635be8/i);
  assert.match(html, /--bg:\s*#111521/i);
  assert.match(html, /var\(--bg\)/);
  assert.match(html, /var\(--text\)/);
  assert.match(html, /#notes-wrap\s*\{[^}]*overflow-y:\s*auto/);
});

test('theme selector supports system, light and dark with local preference', () => {
  assert.match(html, /id="theme-select"[^>]*aria-label="Dashboard appearance"/);
  for (const mode of ['system', 'light', 'dark']) assert.ok(html.includes(`value="${mode}"`));
  assert.match(renderer, /function setDashboardTheme\(/);
  assert.match(renderer, /document\.documentElement\.setAttribute\('data-theme', mode\)/);
  assert.match(renderer, /window\.localStorage\.getItem\(DASHBOARD_THEME_KEY\)/);
  assert.match(renderer, /window\.localStorage\.setItem\(DASHBOARD_THEME_KEY, mode\)/);
  assert.match(renderer, /try\s*\{/);
});

test('restyled cards remain legible and actions wrap at smaller sizes', () => {
  assert.match(html, /\.note-card\s*\{[^}]*grid-template-columns:\s*10px minmax\(0, 1fr\)/);
  assert.match(html, /\.note-actions\s*\{[^}]*grid-column:\s*2/);
  assert.match(html, /\.note-preview\s*\{[^}]*text-overflow:\s*ellipsis/);
  assert.match(html, /\.note-actions\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(html, /@media\s*\(max-width:\s*430px\)/);
  assert.match(html, /button:focus-visible/);
  assert.match(html, /#search-input:focus/);
});

test('theme switching does not require new IPC routes or modify notes', () => {
  assert.doesNotMatch(renderer, /ipcRenderer|require\(['"]electron['"]\)/);
  assert.match(renderer, /themeSelect\.addEventListener\('change'/);
  assert.match(renderer, /dashboardAPI\.onNotes/);
  assert.match(renderer, /document\.querySelectorAll\('\.ftab'\)/);
  assert.match(renderer, /setAttribute\('aria-pressed', String\(selected\)\)/);
});

test('unsafe note HTML is never rendered as card markup', () => {
  assert.match(renderer, /querySelector\('\.note-preview'\)\.textContent\s*=/);
  assert.doesNotMatch(renderer, /<div class="note-preview[^>]*>\$\{preview\}/);
  assert.match(renderer, /getElementById\('notes-wrap'\)\.addEventListener\('click'/);
  assert.doesNotMatch(renderer, /onclick=/);
});
