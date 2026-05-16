const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// ─── DATA STORAGE ──────────────────────────────────────────────────────────────
const DATA_DIR  = app.getPath('userData');
const DATA_FILE = path.join(DATA_DIR, 'notes.json');

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch (e) { console.error('Load error:', e); }
  return [];
}

function saveData(notes) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(notes, null, 2), 'utf8');
  } catch (e) { console.error('Save error:', e); }
}

// ─── STATE ─────────────────────────────────────────────────────────────────────
let allNotes   = loadData();   // source of truth – always in sync with disk
let noteWins   = new Map();    // noteId → BrowserWindow
let dashWin    = null;
let tray       = null;

function nextId() { return Date.now() + Math.floor(Math.random() * 1000); }

function getNoteById(id) { return allNotes.find(n => n.id === id); }

function persistAll() { saveData(allNotes); }

// ─── NOTE WINDOW ───────────────────────────────────────────────────────────────
function openNoteWindow(note) {
  if (noteWins.has(note.id)) {
    const existing = noteWins.get(note.id);
    if (!existing.isDestroyed()) { existing.show(); existing.focus(); return; }
  }

  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const x = note.x ?? Math.floor(20 + Math.random() * (sw - 320));
  const y = note.y ?? Math.floor(20 + Math.random() * (sh - 380));
  const w = note.w ?? 300;
  const h = note.h ?? 360;

  const win = new BrowserWindow({
    x, y, width: w, height: h,
    minWidth: 200, minHeight: 200,
    frame: false,
    transparent: false,
    resizable: true,
    skipTaskbar: true,
    alwaysOnTop: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
    backgroundColor: note.color || '#FFF9C4',
    show: false,
  });

  win.loadFile('note.html');

  win.once('ready-to-show', () => {
    win.show();
    win.webContents.send('init', note);
  });

  win.on('moved', () => {
    const [nx, ny] = win.getPosition();
    const n = getNoteById(note.id);
    if (n) { n.x = nx; n.y = ny; persistAll(); }
  });

  win.on('resized', () => {
    const [nw, nh] = win.getSize();
    const n = getNoteById(note.id);
    if (n) { n.w = nw; n.h = nh; persistAll(); }
  });

  win.on('closed', () => {
    noteWins.delete(note.id);
    refreshDash();
  });

  noteWins.set(note.id, win);
}

// ─── DASHBOARD WINDOW ──────────────────────────────────────────────────────────
function openDashboard() {
  if (dashWin && !dashWin.isDestroyed()) { dashWin.show(); dashWin.focus(); return; }

  dashWin = new BrowserWindow({
    width: 520, height: 600,
    minWidth: 400, minHeight: 400,
    title: "Ray's Note - Dashboard",
    frame: true,
    skipTaskbar: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
    backgroundColor: '#1e1e2e',
    show: false,
  });

  dashWin.setMenu(null);
  dashWin.setIcon(path.join(__dirname, 'note-icon.ico'));
  dashWin.loadFile('dashboard.html');
  dashWin.once('ready-to-show', () => {
    dashWin.show();
    sendDashNotes();
  });
  dashWin.on('closed', () => { dashWin = null; });
}

function sendDashNotes() {
  if (dashWin && !dashWin.isDestroyed()) {
    const openIds = new Set(noteWins.keys());
    dashWin.webContents.send('notes-list', allNotes.map(n => ({
      ...n,
      isOpen: openIds.has(n.id)
    })));
  }
}

function refreshDash() { sendDashNotes(); }

// ─── TRAY ──────────────────────────────────────────────────────────────────────
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

  const rebuild = () => tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Ray's Note", enabled: false },
    { type: 'separator' },
    { label: 'New Note',       click: () => createNewNote() },
    { label: 'Dashboard',      click: () => openDashboard() },
    { type: 'separator' },
    { label: 'Hide All Notes', click: () => noteWins.forEach(w => !w.isDestroyed() && w.hide()) },
    { label: 'Show All Notes', click: () => noteWins.forEach(w => !w.isDestroyed() && w.show()) },
    { type: 'separator' },
    { label: 'Quit Ray\'s Note', click: () => { persistAll(); app.exit(0); } },
  ]));

  rebuild();
  tray.on('click', () => {
    const anyVisible = [...noteWins.values()].some(w => !w.isDestroyed() && w.isVisible());
    if (anyVisible) noteWins.forEach(w => !w.isDestroyed() && w.hide());
    else            noteWins.forEach(w => !w.isDestroyed() && w.show());
  });
}

// ─── HELPERS ───────────────────────────────────────────────────────────────────
function createNewNote() {
  const note = {
    id: nextId(), content: '', color: '#FFF9C4',
    fontSize: 15, dir: 'rtl',
    pinned: false, hidden: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  allNotes.unshift(note);
  persistAll();
  openNoteWindow(note);
  refreshDash();
}

// ─── APP READY ─────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  buildTray();

  // Open notes that were visible (not hidden) at last close
  const visible = allNotes.filter(n => !n.hidden);
  if (visible.length === 0 && allNotes.length === 0) {
    createNewNote();
  } else {
    visible.forEach(n => openNoteWindow(n));
  }
});

app.on('window-all-closed', () => { /* keep running in tray */ });

// Persist before quit
app.on('before-quit', () => { persistAll(); });
process.on('exit', () => { persistAll(); });

// ─── IPC ───────────────────────────────────────────────────────────────────────

// Note sends updated data
ipcMain.on('note-update', (event, data) => {
  const n = getNoteById(data.id);
  if (n) {
    Object.assign(n, data, { updatedAt: new Date().toISOString() });
    persistAll();
    refreshDash();
  }
});

// Close note window (keep data)
ipcMain.on('note-close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  // find which note this window belongs to
  for (const [id, w] of noteWins) {
    if (w === win) {
      const n = getNoteById(id);
      if (n) { n.hidden = true; persistAll(); refreshDash(); }
      break;
    }
  }
  win.close();
});

// Minimize to hidden
ipcMain.on('note-minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.hide();
});

// New note from note window
ipcMain.on('note-new', () => createNewNote());

// Open dashboard from note window
ipcMain.on('open-dashboard', () => openDashboard());

// Dashboard requests list
ipcMain.on('get-notes', (event) => sendDashNotes());

// Dashboard: show a note
ipcMain.on('show-note', (event, id) => {
  const n = getNoteById(id);
  if (!n) return;
  n.hidden = false;
  persistAll();
  openNoteWindow(n);
  refreshDash();
});

// Dashboard: hide a note
ipcMain.on('hide-note', (event, id) => {
  const n = getNoteById(id);
  if (n) { n.hidden = true; persistAll(); }
  const win = noteWins.get(id);
  if (win && !win.isDestroyed()) win.close();
  refreshDash();
});

// Dashboard: delete a note permanently
ipcMain.on('delete-note', (event, id) => {
  allNotes = allNotes.filter(n => n.id !== id);
  persistAll();
  const win = noteWins.get(id);
  if (win && !win.isDestroyed()) win.destroy();
  noteWins.delete(id);
  refreshDash();
});

// Dashboard: create new
ipcMain.on('new-note-from-dash', () => createNewNote());

// Dashboard: pin/unpin
ipcMain.on('pin-note', (event, id) => {
  const n = getNoteById(id);
  if (n) { n.pinned = !n.pinned; persistAll(); refreshDash(); }
});

