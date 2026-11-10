'use strict';

const dashboardAPI = window.raysDashboard;

let allNotes  = [];
let curFilter = 'all';

// Dashboard appearance is independent of note colors and note data.
// First use follows the OS. Only an explicit button click saves an override.
// A new storage key deliberately ignores the old selector setting, so the
// one-click control initially starts from the computer's current appearance.
const DASHBOARD_THEME_KEY = 'rays-note-dashboard-theme-toggle-v2';
const themeToggle = document.getElementById('theme-toggle');
const systemScheme = window.matchMedia('(prefers-color-scheme: dark)');
let preferredTheme = 'system';
try {
  const saved = window.localStorage.getItem(DASHBOARD_THEME_KEY);
  if (saved === 'dark' || saved === 'light') preferredTheme = saved;
} catch { /* OS appearance still works when storage is restricted */ }

function effectiveTheme() {
  return preferredTheme === 'system' ? (systemScheme.matches ? 'dark' : 'light') : preferredTheme;
}
function updateDashboardTheme() {
  const active = effectiveTheme();
  document.documentElement.setAttribute('data-theme', preferredTheme);
  document.documentElement.setAttribute('data-effective-theme', active);
  const next = active === 'dark' ? 'light' : 'dark';
  themeToggle.setAttribute('aria-label', `Switch to ${next} mode`);
  themeToggle.setAttribute('aria-pressed', String(active === 'dark'));
  themeToggle.title = `Switch to ${next} mode (Shift+click: follow system)`;
}
function saveDashboardTheme() {
  try {
    if (preferredTheme === 'system') window.localStorage.removeItem(DASHBOARD_THEME_KEY);
    else window.localStorage.setItem(DASHBOARD_THEME_KEY, preferredTheme);
  } catch { /* no change to saved notes */ }
}
updateDashboardTheme();
themeToggle.addEventListener('click', (event) => {
  preferredTheme = event.shiftKey ? 'system' : (effectiveTheme() === 'dark' ? 'light' : 'dark');
  saveDashboardTheme();
  updateDashboardTheme();
});
// In System mode, icon and accessible label follow Windows appearance changes.
if (typeof systemScheme.addEventListener === 'function') {
  systemScheme.addEventListener('change', () => {
    if (preferredTheme === 'system') updateDashboardTheme();
  });
} else if (typeof systemScheme.addListener === 'function') {
  systemScheme.addListener(() => {
    if (preferredTheme === 'system') updateDashboardTheme();
  });
}

function plainTextContent(html) {
  return (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function noteTitle(note) {
  const title = typeof note?.title === 'string' ? note.title.trim() : '';
  return title || 'Untitled note';
}

function noteSnippet(note) {
  const text = plainTextContent(note?.content || '');
  return text || 'No additional text';
}

// ── Receive notes from main ──────────────────────────────────────────────────
dashboardAPI.onNotes((notes) => {
  allNotes = notes;
  updateStats();
  renderList();
});

// request on load
dashboardAPI.requestNotes();

// ── Stats ────────────────────────────────────────────────────────────────────
function updateStats() {
  document.getElementById('st-total').textContent = allNotes.length;
  document.getElementById('st-open').textContent = allNotes.filter((n) => n.isOpen).length;
  document.getElementById('st-hidden').textContent = allNotes.filter((n) => !n.isOpen).length;
  document.getElementById('st-pinned').textContent = allNotes.filter((n) => n.pinned).length;
}

// ── Filter ───────────────────────────────────────────────────────────────────
function setFilter(btn) {
  document.querySelectorAll('.ftab').forEach((b) => {
    const selected = b === btn;
    b.classList.toggle('on', selected);
    b.setAttribute('aria-pressed', String(selected));
  });
  curFilter = btn.dataset.f;
  renderList();
}

// ── Render ───────────────────────────────────────────────────────────────────
function renderList() {
  const activeButton = document.activeElement?.closest?.('.note-card button[data-action]');
  const activeId = activeButton?.closest('.note-card')?.dataset.id;
  const activeAction = activeButton?.dataset.action;
  const q = document.getElementById('search-input').value.toLowerCase();
  const wrap = document.getElementById('notes-wrap');

  let notes = allNotes;

  if (curFilter === 'open') notes = notes.filter((n) => n.isOpen);
  if (curFilter === 'hidden') notes = notes.filter((n) => !n.isOpen);
  if (curFilter === 'pinned') notes = notes.filter((n) => n.pinned);

  if (q) {
    notes = notes.filter((n) => {
      const searchText = `${noteTitle(n)} ${plainTextContent(n.content || '')}`.toLowerCase();
      return searchText.includes(q);
    });
  }

  const count = document.getElementById('search-count');
  if (count) count.textContent = `${notes.length} ${notes.length === 1 ? 'note' : 'notes'} shown`;

  notes = [...notes].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

  if (!notes.length) {
    const message = allNotes.length ? 'No matching notes' : 'No notes yet';
    const detail = allNotes.length ? 'Try a different search or filter.' : 'Create a note to get started.';
    wrap.innerHTML = `<div class="empty-state"><div class="empty-glyph" aria-hidden="true">+</div><strong>${message}</strong><p>${detail}</p></div>`;
    return;
  }

  wrap.innerHTML = '';
  notes.forEach((n) => {
    const title = noteTitle(n);
    const preview = noteSnippet(n);
    const date = n.updatedAt
      ? new Date(n.updatedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      : '';

    const card = document.createElement('div');
    card.className = 'note-card' + (n.pinned ? ' pinned' : '');
    card.dataset.id = String(n.id);
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', `Note: ${title.slice(0, 80)}`);
    card.innerHTML = `
      <div class="note-swatch"></div>
      <div class="note-body">
        <div class="note-title"></div>
        <div class="note-preview ${preview ? '' : 'empty-preview'}"></div>
        <div class="note-meta">
          <span>${date}</span>
          ${n.isOpen ? '<span class="badge badge-open">On desktop</span>' : '<span class="badge badge-hidden">Hidden</span>'}
          ${n.pinned ? '<span class="badge badge-pinned">Pinned</span>' : ''}
        </div>
      </div>
      <div class="note-actions">
        ${n.isOpen
    ? '<button class="na hide" data-action="hide">Hide</button>'
    : '<button class="na show" data-action="show">Show</button>'}
        <button class="na pin" data-action="pin">${n.pinned ? 'Unpin' : 'Pin on top'}</button>
        <button class="na del" data-action="delete">Delete</button>
      </div>`;
    card.querySelector('.note-swatch').style.background = n.color || '#FFF9C4';
    card.querySelector('.note-title').textContent = title;
    card.querySelector('.note-preview').textContent = preview;
    card.querySelectorAll('button[data-action]').forEach((button) => {
      button.type = 'button';
      button.setAttribute('aria-label', `${button.textContent.trim()}: ${title.slice(0, 50)}`);
    });
    wrap.appendChild(card);
  });

  if (activeId && activeAction) {
    const matching = Array.from(wrap.querySelectorAll('.note-card')).find((c) => c.dataset.id === activeId);
    const focusTarget = matching?.querySelector(`button[data-action="${activeAction}"]`) ||
      matching?.querySelector('button[data-action]');
    focusTarget?.focus();
  }
}

// ── Actions ──────────────────────────────────────────────────────────────────
function showNote(id) { dashboardAPI.show(id); }
function hideNote(id) { dashboardAPI.hide(id); }
function pinNote(id) { dashboardAPI.pin(id); }
function newNote() { dashboardAPI.create(); }

function deleteNote(id) {
  const n = allNotes.find((x) => x.id === id);
  const title = noteTitle(n);
  if (!confirm(`Delete note?\n"${title}"\n\nThis cannot be undone.`)) return;
  dashboardAPI.delete(id);
}

document.getElementById('btn-new-dash').addEventListener('click', newNote);
document.getElementById('search-input').addEventListener('input', renderList);
document.querySelectorAll('.ftab').forEach((btn) => btn.addEventListener('click', () => setFilter(btn)));
document.getElementById('notes-wrap').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  const card = button?.closest('.note-card');
  if (!card) return;
  const id = Number(card.dataset.id);
  if (!Number.isSafeInteger(id) || id <= 0) return;
  const action = button.dataset.action;
  if (action === 'show') showNote(id);
  else if (action === 'hide') hideNote(id);
  else if (action === 'pin') pinNote(id);
  else if (action === 'delete') deleteNote(id);
});

// Search and New Note are available without a mouse. A slash only works when
// focus is outside editable text. Escape clears the active search input.
document.addEventListener('keydown', (event) => {
  window.RaysNoteKeys.dashboard(event, {
    create: newNote,
    search: () => document.getElementById('search-input').focus(),
    clearSearch: () => {
      const search = document.getElementById('search-input');
      if (search.value) { search.value = ''; renderList(); }
      else document.getElementById('btn-new-dash').focus();
    },
  });
});
