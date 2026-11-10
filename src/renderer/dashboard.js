'use strict';

const dashboardAPI = window.raysDashboard;

let allNotes  = [];
let curFilter = 'all';

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
  document.getElementById('st-total').textContent  = allNotes.length;
  document.getElementById('st-open').textContent   = allNotes.filter(n => n.isOpen).length;
  document.getElementById('st-hidden').textContent = allNotes.filter(n => !n.isOpen).length;
  document.getElementById('st-pinned').textContent = allNotes.filter(n => n.pinned).length;
}

// ── Filter ───────────────────────────────────────────────────────────────────
function setFilter(btn) {
  document.querySelectorAll('.ftab').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  curFilter = btn.dataset.f;
  renderList();
}

// ── Render ───────────────────────────────────────────────────────────────────
function renderList() {
  const q     = document.getElementById('search-input').value.toLowerCase();
  const wrap  = document.getElementById('notes-wrap');

  let notes = allNotes;

  // filter
  if (curFilter === 'open')   notes = notes.filter(n => n.isOpen);
  if (curFilter === 'hidden') notes = notes.filter(n => !n.isOpen);
  if (curFilter === 'pinned') notes = notes.filter(n => n.pinned);

  // search
  if (q) {
    notes = notes.filter(n => {
      const text = (n.content || '').replace(/<[^>]+>/g, ' ').toLowerCase();
      return text.includes(q);
    });
  }

  // pinned first
  notes = [...notes].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

  if (!notes.length) {
    wrap.innerHTML = `<div class="empty-state"><div>🔍</div>No notes found</div>`;
    return;
  }

  wrap.innerHTML = '';
  notes.forEach(n => {
    const rawText = (n.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g,' ').trim();
    const preview = rawText || '';
    const date    = n.updatedAt
      ? new Date(n.updatedAt).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })
      : '';

    const card = document.createElement('div');
    card.className = 'note-card' + (n.pinned ? ' pinned' : '');
    card.dataset.id = String(n.id);
    card.innerHTML = `
      <div class="note-swatch"></div>
      <div class="note-body">
        <div class="note-preview ${preview ? '' : 'empty-preview'}"></div>
        <div class="note-meta">
          <span>${date}</span>
          ${n.isOpen   ? '<span class="badge badge-open">● On Desktop</span>'  : '<span class="badge badge-hidden">○ Hidden</span>'}
          ${n.pinned   ? '<span class="badge badge-pinned">📌 Pinned</span>'   : ''}
        </div>
      </div>
      <div class="note-actions">
        ${n.isOpen
          ? `<button class="na hide" data-action="hide">Hide</button>`
          : `<button class="na show" data-action="show">Show</button>`
        }
        <button class="na pin" data-action="pin">${n.pinned ? 'Unpin' : 'Pin on top'}</button>
        <button class="na del" data-action="delete">Delete</button>
      </div>`;
    card.querySelector('.note-swatch').style.background = n.color || '#FFF9C4';
    card.querySelector('.note-preview').textContent = preview || '(empty note)';
    wrap.appendChild(card);
  });
}

// ── Actions ──────────────────────────────────────────────────────────────────
function showNote(id)   { dashboardAPI.show(id); }
function hideNote(id)   { dashboardAPI.hide(id); }
function pinNote(id)    { dashboardAPI.pin(id); }
function newNote()      { dashboardAPI.create(); }

function deleteNote(id) {
  const n = allNotes.find(x => x.id === id);
  const preview = (n?.content || '').replace(/<[^>]+>/g,' ').substring(0, 50) || 'this note';
  if (!confirm(`Delete note?\n"${preview}"\n\nThis cannot be undone.`)) return;
  dashboardAPI.delete(id);
}

// Event delegation avoids executable HTML attributes in note cards.
document.getElementById('btn-new-dash').addEventListener('click', newNote);
document.getElementById('search-input').addEventListener('input', renderList);
document.querySelectorAll('.ftab').forEach(btn => btn.addEventListener('click', () => setFilter(btn)));
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

