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
const pinBtn = document.getElementById('wb-pin');
let pinBusy = false;

function renderPinState(pinned) {
  const active = pinned === true;
  pinBtn.classList.toggle('pinned', active);
  pinBtn.setAttribute('aria-pressed', String(active));
  pinBtn.title = active ? 'Unpin note (normal window)' : 'Pin note on top';
  pinBtn.setAttribute('aria-label', pinBtn.title);
}

noteAPI.onPinChanged((pinned) => renderPinState(pinned));

async function toggleNotePin() {
  if (pinBusy || noteId === null) return;
  pinBusy = true;
  pinBtn.disabled = true;
  try {
    const result = await noteAPI.togglePin();
    if (result && result.ok === true) renderPinState(result.pinned);
    else console.error('Pin change failed:', result?.error || 'Unknown error');
  } catch (error) {
    console.error('Pin change failed:', error);
  } finally {
    pinBusy = false;
    pinBtn.disabled = false;
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
noteAPI.onInit((note) => {
  noteId    = note.id;
  noteColor = note.color   || '#FFF9C4';
  fontSize  = note.fontSize|| 15;
  dir       = note.dir     || 'rtl';
  renderPinState(note.pinned === true);

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
  window.RaysNoteTasks.normalize(editor);
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
    content: window.RaysNoteHtml.sanitize(window.RaysNoteTasks.serializedHTML(editor)),
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
editor.addEventListener('change', event => {
  if (window.RaysNoteTasks.onCheckboxChange(event, editor)) {
    updateWC();
    schedSave();
  }
});
editor.addEventListener('keydown', event => {
  if (window.RaysNoteTasks.onTaskKeydown(event, editor)) {
    updateWC();
    schedSave();
  }
});

function updateWC() {
  const t = editor.innerText.trim();
  wcEl.textContent = t ? t.split(/\s+/).length + ' words' : '0 words';
}

// ── Formatting ────────────────────────────────────────────────────────────────
function preserveSelectionFocus() {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount || !editor.contains(selection.anchorNode)) editor.focus();
}

function fmt(cmd) {
  if (!['bold', 'italic', 'underline'].includes(cmd)) return;
  preserveSelectionFocus();
  document.execCommand(cmd, false, null);
  schedSave();
}

function setAlign(a) {
  preserveSelectionFocus();
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
  if (!Number.isInteger(delta) || Math.abs(delta) !== 1) return;
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
  preserveSelectionFocus();
  window.RaysNoteBullets.toggle(editor, window.getSelection());
  schedSave();
}

// ── Tasks ─────────────────────────────────────────────────────────────────────
function insertTask() {
  window.RaysNoteTasks.insertAtSelection(editor, window.getSelection());
  updateWC();
  schedSave();
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
  document.execCommand('insertText', false, text.replace(/\r\n?/g, '\n'));
  schedSave();
});

// Toolbar pointer events must not steal the current text selection.
// Button click handlers still run after preventDefault() on mousedown.
document.getElementById('toolbar').addEventListener('mousedown', event => {
  if (event.target.closest('button')) event.preventDefault();
});

// External event handlers satisfy the restrictive script-src CSP.
document.getElementById('wb-close').addEventListener('click', () => { void closeNote(); });
document.getElementById('wb-hide').addEventListener('click', hideNote);
document.getElementById('wb-new').addEventListener('click', newNote);
document.getElementById('wb-dash').addEventListener('click', openDash);
document.getElementById('wb-pin').addEventListener('click', () => { void toggleNotePin(); });
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
