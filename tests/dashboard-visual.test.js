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
  assert.match(html, /--accent:\s*#7257db/i);
  assert.match(html, /--bg:\s*#111521/i);
  assert.match(html, /var\(--bg\)/);
  assert.match(html, /var\(--text\)/);
  assert.match(html, /#notes-wrap\s*\{[^}]*overflow-y:\s*auto/);
});

test('one-click sun/moon theme button follows the computer on first use', () => {
  assert.match(html, /id="theme-toggle"[^>]*type="button"/);
  assert.match(html, /id="theme-icon-moon"/);
  assert.match(html, /id="theme-icon-sun"/);
  assert.doesNotMatch(html, /id="theme-select"/);
  assert.match(renderer, /let preferredTheme = 'system'/);
  assert.match(renderer, /window\.matchMedia\('\(prefers-color-scheme: dark\)'\)/);
  assert.match(renderer, /themeToggle\.addEventListener\('click'/);
  assert.match(renderer, /systemScheme\.addEventListener\('change'/);
  assert.match(renderer, /function effectiveTheme\(/);
  assert.match(renderer, /setAttribute\('data-effective-theme', active\)/);
  assert.match(renderer, /setAttribute\('aria-label', `Switch to \$\{next\} mode`\)/);
  assert.match(renderer, /setAttribute\('aria-pressed', String\(active === 'dark'\)\)/);
});

test('explicit theme selection persists and Shift-click returns to OS preference', () => {
  assert.match(renderer, /rays-note-dashboard-theme-toggle-v2/);
  assert.match(renderer, /window\.localStorage\.getItem\(DASHBOARD_THEME_KEY\)/);
  assert.match(renderer, /window\.localStorage\.setItem\(DASHBOARD_THEME_KEY, preferredTheme\)/);
  assert.match(renderer, /window\.localStorage\.removeItem\(DASHBOARD_THEME_KEY\)/);
  assert.match(renderer, /event\.shiftKey \? 'system'/);
  assert.doesNotMatch(renderer, /rays-note-dashboard-theme-v1/);
});

test('light palette has lavender and peach warmth without changing dark palette', () => {
  assert.match(html, /--bg:\s*#f5f0fa/i);
  assert.match(html, /--header-glow:\s*linear-gradient/);
  assert.match(html, /#eee3fe/i);
  assert.match(html, /#fff2e7/i);
  assert.match(html, /--page-glow:\s*radial-gradient/);
  assert.match(html, /--stats-glow:\s*linear-gradient/);
  assert.match(html, /--footer-tint:\s*#f4edf8/i);
  assert.match(html, /--bg:\s*#111521/i);
  assert.match(html, /--header-glow:\s*none/);
  assert.match(html, /#header\s*\{[^}]*background-image:\s*var\(--header-glow\)/);
});

test('restyled cards remain legible and actions wrap at smaller sizes', () => {
  assert.match(html, /\.note-card\s*\{[^}]*grid-template-columns:\s*10px minmax\(0, 1fr\)/);
  assert.match(html, /\.note-actions\s*\{[^}]*grid-column:\s*2/);
  assert.match(html, /\.note-title\s*\{[^}]*text-overflow:\s*ellipsis/);
  assert.match(html, /\.note-preview\s*\{[^}]*-webkit-line-clamp:\s*2/);
  assert.match(html, /\.note-actions\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(html, /@media\s*\(max-width:\s*430px\)/);
  assert.match(html, /button:focus-visible/);
  assert.match(html, /#search-input:focus/);
});

test('theme switching does not require new IPC routes or modify notes', () => {
  assert.doesNotMatch(renderer, /ipcRenderer|require\(['"]electron['"]\)/);
  assert.match(renderer, /themeToggle\.addEventListener\('click'/);
  assert.match(renderer, /dashboardAPI\.onNotes/);
  assert.match(renderer, /document\.querySelectorAll\('\.ftab'\)/);
  assert.match(renderer, /setAttribute\('aria-pressed', String\(selected\)\)/);
});

test('dashboard cards use title and safe text previews', () => {
  assert.match(renderer, /function noteTitle\(/);
  assert.match(renderer, /querySelector\('\.note-title'\)\.textContent\s*=/);
  assert.match(renderer, /querySelector\('\.note-preview'\)\.textContent\s*=/);
  assert.doesNotMatch(renderer, /<div class="note-preview[^>]*>\$\{preview\}/);
  assert.match(renderer, /getElementById\('notes-wrap'\)\.addEventListener\('click'/);
  assert.doesNotMatch(renderer, /onclick=/);
});
