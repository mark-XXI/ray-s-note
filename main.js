const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, dialog } = require('electron');
const path = require('path');
const fs   = require('fs');
const crypto = require('crypto');
const { NoteStore } = require('./src/storage/note-store');
const {
  NoteValidationError, normalizeStoredNotes, allocateNoteId,
  createDefaultNote, applyNotePatch,
} = require('./src/notes/note-model');
const { startDesktopWatcher } = require('./desktop-pin');

// Explicitly opt into isolated local data for development testing.
// Normal `npm start` and packaged builds retain their existing userData path.
if (!app.isPackaged && process.env.RAYS_NOTE_TEST_DATA_DIR) {
  const testDir = path.resolve(process.env.RAYS_NOTE_TEST_DATA_DIR);
  fs.mkdirSync(testDir, { recursive: true });
  app.setPath('userData', testDir);
}

const DATA_DIR  = app.getPath('userData');
const DATA_FILE = path.join(DATA_DIR, 'notes.json');

const noteStore = new NoteStore(DATA_FILE);
let allNotes = [];
const noteWins = new Map();
let dashWin = null;
let tray = null;
let storageErrorReported = false;

function getNoteById(id) { return allNotes.find(n => n.id === id); }

// A change becomes live only after the new file has been safely written.
function commitNotes(nextNotes) {
  const checkedNotes = normalizeStoredNotes(nextNotes);
  noteStore.save(checkedNotes);
  allNotes = checkedNotes;
  storageErrorReported = false;
  refreshDash();
}

function reportStorageFailure(error) {
  console.error('[Ray\'s Note] Storage failure:', error);
  if (storageErrorReported) return;
  storageErrorReported = true;
  dialog.showErrorBox(
    'Ray\'s Note — Save failed',
    'The requested change was not saved. Your existing notes file was not replaced. ' +
      'Check disk space and folder permissions, then try again.\n\n' + error.message
  );
}

// The renderer expects a result and must never display "Saved" before this succeeds.
function saveNoteUpdate(data) {
  if (!data || typeof data !== 'object') return { ok: false, error: 'Invalid note update' };
  const current = getNoteById(data.id);
  if (!current) return { ok: false, error: 'Note no longer exists' };
  try {
    const nextNotes = allNotes.map((note) => note.id === data.id
      ? applyNotePatch(note, {
          content: data.content,
          color: data.color,
          fontSize: data.fontSize,
          dir: data.dir,
          updatedAt: new Date().toISOString(),
        })
      : note);
    commitNotes(nextNotes);
    return { ok: true };
  } catch (error) {
    console.error('[Ray\'s Note] Note update failed:', error);
    return { ok: false, error: error instanceof NoteValidationError
      ? error.message : 'Could not write notes to disk. Please retry.' };
  }
}

function changeNote(id, patch) {
  if (!getNoteById(id)) return false;
  try {
    const nextNotes = allNotes.map((note) => note.id === id
      ? applyNotePatch(note, patch) : note);
    commitNotes(nextNotes);
    return true;
  } catch (error) {
    reportStorageFailure(error);
    return false;
  }
}

// Handshake allows the tray Quit action to wait for pending 700ms editor saves.
const pendingFlushes = new Map();
function flushWindow(win) {
  if (win.isDestroyed()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const requestId = crypto.randomBytes(12).toString('hex');
    const timer = setTimeout(() => {
      pendingFlushes.delete(requestId);
      resolve(false);
    }, 8000);
    pendingFlushes.set(requestId, {
      sender: win.webContents,
      finish: (ok) => {
        clearTimeout(timer);
        pendingFlushes.delete(requestId);
        resolve(ok === true);
      },
    });
    try { win.webContents.send('app-flush-request', requestId); }
    catch (error) { pendingFlushes.get(requestId)?.finish(false); }
  });
}

ipcMain.on('app-flush-result', (event, result) => {
  if (!result || typeof result.requestId !== 'string') return;
  const request = pendingFlushes.get(result.requestId);
  if (request && request.sender === event.sender) request.finish(result.ok);
});

let quittingFromTray = false;
async function quitSafely() {
  if (quittingFromTray) return;
  quittingFromTray = true;
  try {
    for (const win of noteWins.values()) {
      if (!await flushWindow(win)) {
        dialog.showErrorBox(
          'Ray\'s Note — Unsaved changes',
          'A note could not confirm its latest save. Quit was cancelled; retry after saving.'
        );
        return;
      }
    }
    app.quit();
  } finally {
    quittingFromTray = false;
  }
}

// ── Note Window ────────────────────────────────────────────────────────────────
function openNoteWindow(note) {
  if (noteWins.has(note.id)) {
    const ex = noteWins.get(note.id);
    if (!ex.isDestroyed()) { ex.show(); ex.focus(); return; }
  }

  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    x: note.x ?? Math.floor(20 + Math.random() * (sw - 320)),
    y: note.y ?? Math.floor(20 + Math.random() * (sh - 380)),
    width:  note.w ?? 300,
    height: note.h ?? 360,
    minWidth: 200, minHeight: 200,
    frame: false, transparent: false,
    resizable: true, skipTaskbar: true,
    alwaysOnTop: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
    backgroundColor: note.color || '#FFF9C4',
    show: false,
  });

  win.loadFile('note.html');

  win.once('ready-to-show', () => {
    win.show();
    win.webContents.send('init', note);
    // Start native watcher — restores window if Show Desktop minimizes it
    startDesktopWatcher(win);
  });

  win.on('moved', () => {
    const [nx, ny] = win.getPosition();
    const n = getNoteById(note.id);
    if (n) changeNote(note.id, { x: nx, y: ny });
  });

  win.on('resized', () => {
    const [nw, nh] = win.getSize();
    const n = getNoteById(note.id);
    if (n) changeNote(note.id, { w: nw, h: nh });
  });

  win.on('closed', () => { noteWins.delete(note.id); refreshDash(); });

  noteWins.set(note.id, win);
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function openDashboard() {
  if (dashWin && !dashWin.isDestroyed()) { dashWin.show(); dashWin.focus(); return; }

  dashWin = new BrowserWindow({
    width: 520, height: 600, minWidth: 400, minHeight: 400,
    title: "Ray's Note - Dashboard",
    frame: true, skipTaskbar: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
    backgroundColor: '#1e1e2e', show: false,
  });

  dashWin.setMenu(null);
  try { dashWin.setIcon(path.join(__dirname, 'note-icon.ico')); } catch {}
  dashWin.loadFile('dashboard.html');
  dashWin.once('ready-to-show', () => { dashWin.show(); sendDashNotes(); });
  dashWin.on('closed', () => { dashWin = null; });
}

function sendDashNotes() {
  if (!dashWin || dashWin.isDestroyed()) return;
  const openIds = new Set(noteWins.keys());
  dashWin.webContents.send('notes-list', allNotes.map(n => ({
    ...n, isOpen: openIds.has(n.id)
  })));
}

function refreshDash() { sendDashNotes(); }

// ── Tray ──────────────────────────────────────────────────────────────────────
function buildTray() {
  const iconPath = path.join(__dirname, 'note-icon.ico');
  let img;
  try {
    img = fs.existsSync(iconPath)
      ? nativeImage.createFromPath(iconPath)
      : nativeImage.createEmpty();
  } catch { img = nativeImage.createEmpty(); }

  tray = new Tray(img);
  tray.setToolTip("Ray's Note");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Ray's Note", enabled: false },
    { type: 'separator' },
    { label: 'New Note',   click: () => createNewNote()  },
    { label: 'Dashboard',  click: () => openDashboard()  },
    { type: 'separator' },
    { label: 'Hide All Notes', click: () => noteWins.forEach(w => !w.isDestroyed() && w.hide()) },
    { label: 'Show All Notes', click: () => noteWins.forEach(w => !w.isDestroyed() && w.show()) },
    { type: 'separator' },
    { label: "Quit Ray's Note", click: () => { void quitSafely(); } },
  ]));

  tray.on('click', () => {
    const anyVisible = [...noteWins.values()].some(w => !w.isDestroyed() && w.isVisible());
    if (anyVisible) noteWins.forEach(w => !w.isDestroyed() && w.hide());
    else            noteWins.forEach(w => !w.isDestroyed() && w.show());
  });
}

function createNewNote() {
  const note = createDefaultNote(allocateNoteId(allNotes));
  try {
    commitNotes([note, ...allNotes]);
    openNoteWindow(note);
  } catch (error) {
    reportStorageFailure(error);
  }
}

// ── App Ready ─────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  try {
    allNotes = normalizeStoredNotes(noteStore.load());
  } catch (error) {
    console.error("[Ray's Note] Refusing to overwrite unreadable notes:", error);
    dialog.showErrorBox(
      "Ray's Note — Cannot open notes",
      "The notes file could not be read. Ray's Note will exit without changing it.\n\n" +
      error.message
    );
    app.quit();
    return;
  }
  buildTray();
  const visible = allNotes.filter(n => !n.hidden);
  if (visible.length === 0 && allNotes.length === 0) createNewNote();
  else visible.forEach(n => openNoteWindow(n));
});

app.on('window-all-closed', () => {});
// No unconditional exit write: it could overwrite unreadable data or stale edits.

// ── IPC ───────────────────────────────────────────────────────────────────────
ipcMain.handle('note-update', (_event, data) => saveNoteUpdate(data));

ipcMain.on('note-close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  for (const [id, w] of noteWins) {
    if (w === win) {
      const n = getNoteById(id);
      if (n && !changeNote(id, { hidden: true })) return;
      break;
    }
  }
  win.close();
});

// User hide: win.hide() = SW_HIDE → IsIconic stays false → watcher ignores it
ipcMain.on('note-minimize',  (event) => { const w = BrowserWindow.fromWebContents(event.sender); if (w) { w._userHide = true; w.hide(); } });
ipcMain.on('note-new',       ()      => createNewNote());
ipcMain.on('open-dashboard', ()      => openDashboard());
ipcMain.on('get-notes',      (event) => sendDashNotes());

ipcMain.on('show-note', (event, id) => {
  const n = getNoteById(id);
  if (!n) return;
  if (!changeNote(id, { hidden: false })) return;
  const ex = noteWins.get(id);
  if (ex && !ex.isDestroyed()) ex.show();
  else openNoteWindow(n);
  refreshDash();
});

ipcMain.on('hide-note', (_event, id) => {
  void (async () => {
    if (!getNoteById(id)) return;
    const win = noteWins.get(id);
    if (win && !win.isDestroyed() && !await flushWindow(win)) {
      dialog.showErrorBox("Ray's Note — Unsaved changes",
        'Could not save the latest edits, so this note was not hidden.');
      return;
    }
    if (!changeNote(id, { hidden: true })) return;
    if (win && !win.isDestroyed()) win.close();
    refreshDash();
  })().catch(reportStorageFailure);
});

ipcMain.on('delete-note', (event, id) => {
  try { commitNotes(allNotes.filter(n => n.id !== id)); }
  catch (error) { reportStorageFailure(error); return; }
  const win = noteWins.get(id);
  if (win && !win.isDestroyed()) win.destroy();
  noteWins.delete(id); refreshDash();
});

ipcMain.on('new-note-from-dash', () => createNewNote());
ipcMain.on('pin-note', (event, id) => {
  const n = getNoteById(id);
  if (n) changeNote(id, { pinned: !n.pinned });
});
