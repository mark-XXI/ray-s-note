const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs   = require('fs');
const { startDesktopWatcher } = require('./desktop-pin');

const DATA_DIR  = app.getPath('userData');
const DATA_FILE = path.join(DATA_DIR, 'notes.json');

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch (e) {}
  return [];
}

function saveData(notes) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(notes, null, 2), 'utf8');
  } catch (e) {}
}

let allNotes = loadData();
let noteWins = new Map();
let dashWin  = null;
let tray     = null;

function nextId()        { return Date.now() + Math.floor(Math.random() * 1000); }
function getNoteById(id) { return allNotes.find(n => n.id === id); }
function persistAll()    { saveData(allNotes); }

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
    if (n) { n.x = nx; n.y = ny; persistAll(); }
  });

  win.on('resized', () => {
    const [nw, nh] = win.getSize();
    const n = getNoteById(note.id);
    if (n) { n.w = nw; n.h = nh; persistAll(); }
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
    { label: "Quit Ray's Note", click: () => { persistAll(); app.exit(0); } },
  ]));

  tray.on('click', () => {
    const anyVisible = [...noteWins.values()].some(w => !w.isDestroyed() && w.isVisible());
    if (anyVisible) noteWins.forEach(w => !w.isDestroyed() && w.hide());
    else            noteWins.forEach(w => !w.isDestroyed() && w.show());
  });
}

function createNewNote() {
  const note = {
    id: nextId(), content: '', color: '#FFF9C4',
    fontSize: 15, dir: 'rtl', pinned: false, hidden: false,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  allNotes.unshift(note);
  persistAll();
  openNoteWindow(note);
  refreshDash();
}

// ── App Ready ─────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  buildTray();
  const visible = allNotes.filter(n => !n.hidden);
  if (visible.length === 0 && allNotes.length === 0) createNewNote();
  else visible.forEach(n => openNoteWindow(n));
});

app.on('window-all-closed', () => {});
app.on('before-quit', () => persistAll());
process.on('exit',   () => persistAll());

// ── IPC ───────────────────────────────────────────────────────────────────────
ipcMain.on('note-update', (event, data) => {
  const n = getNoteById(data.id);
  if (n) { Object.assign(n, data, { updatedAt: new Date().toISOString() }); persistAll(); refreshDash(); }
});

ipcMain.on('note-close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  for (const [id, w] of noteWins) {
    if (w === win) {
      const n = getNoteById(id);
      if (n) { n.hidden = true; persistAll(); refreshDash(); }
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
  n.hidden = false; persistAll();
  const ex = noteWins.get(id);
  if (ex && !ex.isDestroyed()) ex.show();
  else openNoteWindow(n);
  refreshDash();
});

ipcMain.on('hide-note', (event, id) => {
  const n = getNoteById(id);
  if (n) { n.hidden = true; persistAll(); }
  const win = noteWins.get(id);
  if (win && !win.isDestroyed()) win.close();
  refreshDash();
});

ipcMain.on('delete-note', (event, id) => {
  allNotes = allNotes.filter(n => n.id !== id); persistAll();
  const win = noteWins.get(id);
  if (win && !win.isDestroyed()) win.destroy();
  noteWins.delete(id); refreshDash();
});

ipcMain.on('new-note-from-dash', () => createNewNote());
ipcMain.on('pin-note', (event, id) => {
  const n = getNoteById(id);
  if (n) { n.pinned = !n.pinned; persistAll(); refreshDash(); }
});
