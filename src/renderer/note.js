'use strict';

const noteAPI = window.raysNote;

let noteId   = null;
let noteColor = '#FFF9C4';
let fontSize  = 15;
let dir       = 'rtl';
let saveTimer = null;

const editor  = document.getElementById('editor');
const szLbl   = document.getElementById('sz-lbl');
const wcEl    = document.getElementById('wc');
const saveDot = document.getElementById('save-dot');
const saveLbl = document.getElementById('save-lbl');

// ── Init ──────────────────────────────────────────────────────────────────────
noteAPI.onInit((note) => {
  noteId    = note.id;
  noteColor = note.color   || '#FFF9C4';
  fontSize  = note.fontSize|| 15;
  dir       = note.dir     || 'rtl';

  editor.innerHTML       = window.RaysNoteHtml.sanitize(note.content || '');
  editor.style.fontSize  = fontSize + 'px';
  editor.style.direction = dir;
  editor.style.textAlign = dir === 'rtl' ? 'right' : 'left';
  szLbl.textContent      = fontSize;
  document.body.style.background = noteColor;

  // mark active color dot
  document.querySelectorAll('.cd').forEach(d => {
    d.classList.toggle('on', d.dataset.c === noteColor);
  });

  // re-attach task checkboxes (in case content was saved with them)
  rebindTasks();
  updateWC();
  setSaved(true);

  document.getElementById('color-row').style.display = 'none';
  document.getElementById('toolbar').style.display   = 'none';
  toolbarVisible = false;
});

// ── Save logic ────────────────────────────────────────────────────────────────
let revision = 0;
let savedRevision = 0;
let inFlight = null;

function schedSave() {
  revision += 1;
  setSaveState('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void saveSnapshot(); }, 700);
}

// Each write is acknowledged by the main process, not merely queued through IPC.
async function saveSnapshot() {
  if (inFlight) {
    const prior = inFlight;
    await prior;
    // A new edit may have been made while the earlier snapshot was saving.
    if (inFlight === prior) inFlight = null;
  }
  if (savedRevision >= revision) return true;
  const currentRevision = revision;
  const payload = {
    id: noteId,
    content: window.RaysNoteHtml.sanitize(editor.innerHTML),
    color: noteColor,
    fontSize,
    dir,
  };
  const task = noteAPI.save(payload)
    .then((reply) => {
      if (!reply || reply.ok !== true) {
        setSaveState('error');
        return false;
      }
      savedRevision = Math.max(savedRevision, currentRevision);
      if (savedRevision === revision) setSaveState('saved');
      return true;
    })
    .catch((error) => {
      console.error('Could not save note:', error);
      setSaveState('error');
      return false;
    });
  inFlight = task;
  try { return await task; }
  finally { if (inFlight === task) inFlight = null; }
}

async function flushPendingSave() {
  clearTimeout(saveTimer);
  // The edit revision can change while a save is running.
  while (savedRevision < revision) {
    const ok = await saveSnapshot();
    if (!ok) return false;
  }
  return true;
}

function setSaveState(state) {
  saveDot.style.color = state === 'saved' ? 'rgba(0,0,0,0.2)' : '#e53e3e';
  saveLbl.textContent = state === 'saved' ? 'Saved' :
    (state === 'error' ? 'Save failed — retry editing' : 'Saving...');
  saveLbl.title = state === 'error' ? 'The latest changes are not on disk.' : '';
}

function setSaved(yes) { setSaveState(yes ? 'saved' : 'saving'); }

noteAPI.onFlushRequest(async (requestId) => {
  const ok = await flushPendingSave();
  noteAPI.flushResult(requestId, ok);
});

editor.addEventListener('input', () => { updateWC(); schedSave(); });

function updateWC() {
  const t = editor.innerText.trim();
  wcEl.textContent = t ? t.split(/\s+/).length + ' words' : '0 words';
}

// ── Formatting ────────────────────────────────────────────────────────────────
function fmt(cmd) { editor.focus(); document.execCommand(cmd, false, null); schedSave(); }

function setAlign(a) {
  editor.focus();
  document.execCommand('justify' + a.charAt(0).toUpperCase() + a.slice(1));
  schedSave();
}

function setDir(d) {
  dir = d;
  editor.style.direction = d;
  editor.style.textAlign = d === 'rtl' ? 'right' : 'left';
  schedSave();
}

function changeSize(delta) {
  const sel = window.getSelection();
  const hasSelection = sel && !sel.isCollapsed && editor.contains(sel.anchorNode);

  if (hasSelection) {
    const range = sel.getRangeAt(0);

    // Detect current font size of the selected text
    let curSize = fontSize;
    const node = sel.anchorNode;
    const el = (node.nodeType === 3) ? node.parentElement : node;
    if (el) {
      const computed = parseFloat(window.getComputedStyle(el).fontSize);
      if (!isNaN(computed)) curSize = Math.round(computed);
    }

    const newSize = Math.min(30, Math.max(10, curSize + delta));

    // Wrap selection in a span with the new size
    const fragment = range.extractContents();
    const span = document.createElement('span');
    span.style.fontSize = newSize + 'px';
    span.appendChild(fragment);
    range.insertNode(span);

    // Restore selection
    const newRange = document.createRange();
    newRange.selectNodeContents(span);
    sel.removeAllRanges();
    sel.addRange(newRange);

    // Update label to reflect selection's new size
    szLbl.textContent = newSize;

  } else {
    // No selection → apply to whole note
    fontSize = Math.min(30, Math.max(10, fontSize + delta));
    editor.style.fontSize = fontSize + 'px';
    szLbl.textContent = fontSize;
  }
  schedSave();
}

// ── Color ─────────────────────────────────────────────────────────────────────
function setColor(dot) {
  document.querySelectorAll('.cd').forEach(d => d.classList.remove('on'));
  dot.classList.add('on');
  noteColor = dot.dataset.c;
  document.body.style.background = noteColor;
  schedSave();
}

// ── Bullet ────────────────────────────────────────────────────────────────────
function insertBullet() {
  editor.focus();
  document.execCommand('insertHTML', false, '<div>• </div>');
  schedSave();
}

// ── Tasks ─────────────────────────────────────────────────────────────────────
function insertTask() {
  editor.focus();
  const id = 'tk' + Date.now();
  const html = `<div class="task-row" id="${id}">` +
    `<input type="checkbox">` +
    `<span class="task-text" contenteditable="true">New task</span>` +
    `</div>`;
  document.execCommand('insertHTML', false, html);

  // place cursor on task text
  const el = document.getElementById(id);
  if (el) {
    const span = el.querySelector('.task-text');
    if (span) {
      el.querySelector('input[type=checkbox]')?.addEventListener('change', event => toggleTask(event.target));
      span.focus();
      const r = document.createRange();
      r.selectNodeContents(span);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    }
  }
  schedSave();
}

function toggleTask(cb) {
  const span = cb.nextElementSibling;
  if (!span) return;
  span.classList.toggle('done', cb.checked);
  schedSave();
}

function rebindTasks() {
  editor.querySelectorAll('.task-row input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => toggleTask(cb));
    const span = cb.nextElementSibling;
    if (span && cb.checked) span.classList.add('done');
  });
}

// ── Window controls ───────────────────────────────────────────────────────────
async function closeNote() {
  if (await flushPendingSave()) noteAPI.close();
}
function hideNote()  { noteAPI.hide(); }
function newNote()   { noteAPI.create(); }
function openDash()  { noteAPI.dashboard(); }
let toolbarVisible = true;
function toggleToolbar() {
  toolbarVisible = !toolbarVisible;
  document.getElementById('color-row').style.display = toolbarVisible ? '' : 'none';
  document.getElementById('toolbar').style.display   = toolbarVisible ? '' : 'none';
}

// Treat clipboard HTML as untrusted. Formatting paste can be reintroduced
// later only after explicit allowlisting of its semantics.
editor.addEventListener('paste', (event) => {
  event.preventDefault();
  const text = event.clipboardData?.getData('text/plain') || '';
  document.execCommand('insertText', false, text);
  schedSave();
});

// External event handlers satisfy the restrictive script-src CSP.
document.getElementById('wb-close').addEventListener('click', () => { void closeNote(); });
document.getElementById('wb-hide').addEventListener('click', hideNote);
document.getElementById('wb-new').addEventListener('click', newNote);
document.getElementById('wb-dash').addEventListener('click', openDash);
document.getElementById('wb-toolbar').addEventListener('click', toggleToolbar);
document.querySelectorAll('.cd').forEach(dot => dot.addEventListener('click', () => setColor(dot)));
document.querySelectorAll('[data-format]').forEach(btn => btn.addEventListener('click', () => fmt(btn.dataset.format)));
document.querySelectorAll('[data-align]').forEach(btn => btn.addEventListener('click', () => setAlign(btn.dataset.align)));
document.querySelectorAll('[data-direction]').forEach(btn => btn.addEventListener('click', () => setDir(btn.dataset.direction)));
document.querySelectorAll('[data-command]').forEach(btn => btn.addEventListener('click', () => {
  if (btn.dataset.command === 'bullet') insertBullet();
  else if (btn.dataset.command === 'task') insertTask();
}));
document.querySelectorAll('[data-font-delta]').forEach(btn => btn.addEventListener('click', () => changeSize(Number(btn.dataset.fontDelta))));

