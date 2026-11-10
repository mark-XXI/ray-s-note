const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, dialog, session } = require('electron');
const path = require('path');
const fs   = require('fs');
const crypto = require('crypto');
const { NoteStore } = require('./src/storage/note-store');
const {
  NoteValidationError, normalizeStoredNotes, allocateNoteId,
  createDefaultNote, applyNotePatch,
} = require('./src/notes/note-model');
const { startDesktopWatcher } = require('./desktop-pin');
const { NoteLifecycle } = require('./src/windows/note-lifecycle');
const { NotePinning } = require('./src/windows/note-pinning');
const { isTrustedFrame, isAuthorizedNoteUpdate } = require('./src/security/ipc-policy');

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
// Session-only setting: use a user-controllable, event-driven alternative to
// the old 150ms minimize polling loop. Notes' persisted visibility is unchanged.
let restoreOnShowDesktop = true;
const desktopWatchers = new Map();

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
  if (win.isDestroyed() || !win._rayReady) return Promise.resolve(true);
  return new Promise((resolve) => {
    const requestId = crypto.randomBytes(12).toString('hex');
    let finished = false;
    const onClosed = () => finish(false);
    const timer = setTimeout(() => finish(false), 8000);
    const finish = (ok) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      win.removeListener('closed', onClosed);
      pendingFlushes.delete(requestId);
      resolve(ok === true);
    };
    pendingFlushes.set(requestId, { sender: win.webContents, finish });
    win.once('closed', onClosed);
    try { win.webContents.send('app-flush-request', requestId); }
    catch (error) { finish(false); }
  });
}

ipcMain.on('app-flush-result', (event, result) => {
  if (!result || typeof result.requestId !== 'string') return;
  const request = pendingFlushes.get(result.requestId);
  if (request && trustedNoteId(event) !== null && request.sender === event.sender && typeof result.ok === 'boolean') request.finish(result.ok);
});

function removeNote(id) {
  if (!getNoteById(id)) return false;
  try {
    commitNotes(allNotes.filter((note) => note.id !== id));
    return true;
  } catch (error) {
    reportStorageFailure(error);
    return false;
  }
}

function reportUnsaved() {
  dialog.showErrorBox(
    "Ray's Note — Unsaved changes",
    'The latest edits could not be saved. The note was left open; retry after saving.'
  );
}

const noteLifecycle = new NoteLifecycle({
  getNote: getNoteById,
  listNotes: () => allNotes,
  updateNote: changeNote,
  removeNote,
  getWindow: (id) => noteWins.get(id),
  openWindow: openNoteWindow,
  flushWindow,
  reportError: reportStorageFailure,
  reportUnsaved,
  refresh: refreshDash,
});

// Dashboard and individual note pin controls share this single operation.
const notePinning = new NotePinning({
  getNote: getNoteById,
  getWindow: (id) => noteWins.get(id),
  persistPinned: (id, pinned) => changeNote(id, { pinned }),
  notify: (id, pinned) => {
    const win = noteWins.get(id);
    if (win && !win.isDestroyed() && win._rayReady) {
      win.webContents.send('note-pin-changed', pinned);
    }
  },
  reportError: (error) => {
    console.error("[Ray's Note] Pinning failed:", error);
    dialog.showErrorBox("Ray's Note — Pin failed", error.message || String(error));
  },
});

let shutdownApproved = false;
let shutdownInProgress = false;
async function quitSafely() {
  if (shutdownInProgress || shutdownApproved) return;
  shutdownInProgress = true;
  try {
    await noteLifecycle.whenIdle();
    for (const win of [...noteWins.values()]) {
      if (!win.isDestroyed() && !await flushWindow(win)) {
        reportUnsaved();
        return;
      }
    }
    // The normal before-quit event runs again here; only the fully
    // acknowledged path is allowed to close its note windows.
    shutdownApproved = true;
    app.quit();
  } catch (error) {
    reportStorageFailure(error);
  } finally {
    shutdownInProgress = false;
  }
}

// Local, packaged UI only: links, frames and popups must never navigate to remote pages.
function lockRendererWindow(win) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
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
    alwaysOnTop: note.pinned === true,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      preload: path.join(__dirname, 'src/preload/note.js'),
    },
    backgroundColor: note.color || '#FFF9C4',
    show: false,
  });

  win._rayReady = false;
  lockRendererWindow(win);
  win.loadFile('note.html');

  win.once('ready-to-show', () => {
    if (win.isDestroyed() || !getNoteById(note.id) || getNoteById(note.id).hidden) return;
    win.webContents.send('init', getNoteById(note.id));
    win._rayReady = true;
    win.show();
    const watcher = startDesktopWatcher(win, {
      enabled: restoreOnShowDesktop,
      shouldRestore: () => !shutdownApproved &&
        !!getNoteById(note.id) && !getNoteById(note.id).hidden,
      onError: (error) => console.warn("[Ray's Note] Desktop recovery failed:", error),
    });
    desktopWatchers.set(note.id, watcher);
    refreshDash();
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

  // Native close (Alt+F4, window manager, etc.) must take the same
  // flush-and-persist path as the editor's red Close button.
  win.on('close', (event) => {
    if (shutdownApproved) return;
    event.preventDefault();
    void noteLifecycle.hide(note.id);
  });

  win.on('closed', () => {
    const watcher = desktopWatchers.get(note.id);
    if (watcher) watcher.stop();
    desktopWatchers.delete(note.id);
    if (noteWins.get(note.id) === win) noteWins.delete(note.id);
    refreshDash();
  });

  noteWins.set(note.id, win);
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function openDashboard() {
  if (dashWin && !dashWin.isDestroyed()) { dashWin.show(); dashWin.focus(); return; }

  dashWin = new BrowserWindow({
    width: 520, height: 600, minWidth: 400, minHeight: 400,
    title: "Ray's Note - Dashboard",
    frame: true, skipTaskbar: false,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      preload: path.join(__dirname, 'src/preload/dashboard.js'),
    },
    backgroundColor: '#1e1e2e', show: false,
  });

  lockRendererWindow(dashWin);
  dashWin.setMenu(null);
  try { dashWin.setIcon(path.join(__dirname, 'note-icon.ico')); } catch {}
  dashWin.loadFile('dashboard.html');
  dashWin.once('ready-to-show', () => { dashWin.show(); sendDashNotes(); });
  dashWin.on('closed', () => { dashWin = null; });
}

function sendDashNotes() {
  if (!dashWin || dashWin.isDestroyed()) return;
  dashWin.webContents.send('notes-list', allNotes.map((note) => {
    const win = noteWins.get(note.id);
    return {
      ...note,
      isOpen: !note.hidden && !!win && !win.isDestroyed() &&
        (win.isVisible() || !win._rayReady),
    };
  }));
}

function refreshDash() { sendDashNotes(); }

// A deterministic manual recovery path if Explorer keeps a note behind the
// desktop after Win+D. Only reveal notes that were already marked visible.
// Never bring intentionally hidden notes back or mutate the notes JSON file.
function revealVisibleNotes() {
  for (const note of allNotes) {
    if (note.hidden) continue;
    const win = noteWins.get(note.id);
    if (!win || win.isDestroyed()) {
      openNoteWindow(note);
      continue;
    }
    try {
      if (win.isMinimized()) win.restore();
      if (!win.isVisible()) win.showInactive();
      win.moveTop(); // Z-order only: never explicitly activate the editor.
    } catch (error) {
      console.warn("[Ray's Note] Could not reveal note:", note.id, error);
    }
  }
}

function setDesktopRecovery(enabled) {
  restoreOnShowDesktop = enabled === true;
  for (const watcher of desktopWatchers.values()) {
    watcher.setEnabled(restoreOnShowDesktop);
  }
}

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
    { label: 'Hide All Notes', click: () => { void noteLifecycle.hideAll(); } },
    { label: 'Show All Notes', click: () => { void noteLifecycle.showAll(); } },
    { type: 'separator' },
    { label: 'Reveal Visible Notes', click: () => revealVisibleNotes() },
    {
      label: 'Recover notes after Win+D', type: 'checkbox',
      checked: restoreOnShowDesktop,
      click: (item) => setDesktopRecovery(item.checked),
    },
    { type: 'separator' },
    { label: "Quit Ray's Note", click: () => { void quitSafely(); } },
  ]));

  tray.on('click', () => {
    const anyVisible = [...noteWins.values()].some(w => !w.isDestroyed() && w.isVisible());
    if (anyVisible) void noteLifecycle.hideAll();
    else void noteLifecycle.showAll();
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
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
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
app.on('before-quit', (event) => {
  if (shutdownApproved) return;
  event.preventDefault();
  void quitSafely();
});
// No unconditional exit write: it could overwrite unreadable data or stale edits.

// ── Authorized IPC — never trust arbitrary renderer calls ─────────────────────
function noteIdFromSender(sender) {
  for (const [id, win] of noteWins) {
    if (!win.isDestroyed() && win.webContents === sender) return id;
  }
  return null;
}

function trustedNoteId(event) {
  const id = noteIdFromSender(event.sender);
  if (id === null) return null;
  const win = noteWins.get(id);
  return win && isTrustedFrame(event, win.webContents) ? id : null;
}

function trustedDashboard(event) {
  return dashWin && !dashWin.isDestroyed() &&
    isTrustedFrame(event, dashWin.webContents);
}

ipcMain.handle('note-update', (event, data) => {
  const id = trustedNoteId(event);
  if (id === null || !isAuthorizedNoteUpdate(id, data)) {
    return { ok: false, error: 'Unauthorized note update' };
  }
  return saveNoteUpdate(data);
});

ipcMain.on('note-close', (event) => {
  const id = trustedNoteId(event);
  if (id !== null) void noteLifecycle.hide(id);
});
ipcMain.on('note-minimize', (event) => {
  const id = trustedNoteId(event);
  if (id !== null) void noteLifecycle.hide(id);
});
ipcMain.on('note-new', (event) => {
  if (trustedNoteId(event) !== null) createNewNote();
});
ipcMain.on('open-dashboard', (event) => {
  if (trustedNoteId(event) !== null) openDashboard();
});
ipcMain.on('get-notes', (event) => {
  if (trustedDashboard(event)) sendDashNotes();
});
ipcMain.on('show-note', (event, id) => {
  if (trustedDashboard(event) && Number.isSafeInteger(id)) void noteLifecycle.show(id);
});
ipcMain.on('hide-note', (event, id) => {
  if (trustedDashboard(event) && Number.isSafeInteger(id)) void noteLifecycle.hide(id);
});
ipcMain.on('delete-note', (event, id) => {
  if (trustedDashboard(event) && Number.isSafeInteger(id)) void noteLifecycle.delete(id);
});
ipcMain.on('new-note-from-dash', (event) => {
  if (trustedDashboard(event)) createNewNote();
});
// Renderer pin actions cannot choose arbitrary note IDs.
ipcMain.handle('toggle-note-pin', (event) => {
  const id = trustedNoteId(event);
  if (id === null) return { ok: false, error: 'Unauthorized pin request' };
  return notePinning.toggle(id);
});
ipcMain.on('pin-note', (event, id) => {
  if (trustedDashboard(event) && Number.isSafeInteger(id) && id > 0) {
    notePinning.toggle(id);
  }
});
