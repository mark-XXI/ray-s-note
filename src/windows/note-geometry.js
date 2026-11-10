'use strict';

// Electron screen and BrowserWindow bounds are expressed in device-independent
// pixels (DIP). No conversion by display.scaleFactor is appropriate here.
// The saved note rectangle remains the user's preferred placement; any
// automatic fallback after changing displays is visual/session-only.
const DEFAULT_WIDTH = 300;
const DEFAULT_HEIGHT = 360;
const MIN_WIDTH = 280;
const MIN_HEIGHT = 320;
const HEADER_WIDTH = 96;
const HEADER_HEIGHT = 24;

function integer(value, fallback) {
  return Number.isSafeInteger(value) ? value : fallback;
}

function workAreas(displays) {
  return (Array.isArray(displays) ? displays : [])
    .filter(d => d && d.workArea &&
      Number.isFinite(d.workArea.x) && Number.isFinite(d.workArea.y) &&
      Number.isFinite(d.workArea.width) && Number.isFinite(d.workArea.height) &&
      d.workArea.width > 0 && d.workArea.height > 0)
    .map(d => ({
      id: d.id, primary: !!d.primary,
      x: Math.round(d.workArea.x), y: Math.round(d.workArea.y),
      width: Math.round(d.workArea.width), height: Math.round(d.workArea.height),
    }));
}

function intersection(a, b) {
  const w = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return w * h;
}

function distanceSquared(rect, workArea) {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const x = Math.max(workArea.x, Math.min(cx, workArea.x + workArea.width));
  const y = Math.max(workArea.y, Math.min(cy, workArea.y + workArea.height));
  return (cx - x) ** 2 + (cy - y) ** 2;
}

function sameBounds(a, b) {
  return !!a && !!b && ['x', 'y', 'width', 'height'].every(k => a[k] === b[k]);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, Math.max(min, max)));
}

function planNoteBounds(note, displays, index = 0) {
  const areas = workAreas(displays);
  if (!areas.length) {
    // A bad or temporarily empty display list should never erase note data.
    return { bounds: {
      x: integer(note.x, 40), y: integer(note.y, 40),
      width: Math.max(MIN_WIDTH, integer(note.w, DEFAULT_WIDTH)),
      height: Math.max(MIN_HEIGHT, integer(note.h, DEFAULT_HEIGHT)),
    }, adjusted: false, unavailable: true };
  }
  const primary = areas.find(a => a.primary) || areas[0];
  const cascade = Math.max(0, index % 7) * 28;
  const desired = {
    x: integer(note.x, primary.x + 40 + cascade),
    y: integer(note.y, primary.y + 40 + cascade),
    width: Math.max(MIN_WIDTH, integer(note.w, DEFAULT_WIDTH)),
    height: Math.max(MIN_HEIGHT, integer(note.h, DEFAULT_HEIGHT)),
  };

  // Keep existing cross-display positions if their titlebar is accessible on
  // any connected display. An offscreen corner is okay; a lost titlebar isn't.
  const titlebar = {
    x: desired.x, y: desired.y,
    width: Math.min(HEADER_WIDTH, desired.width),
    height: Math.min(HEADER_HEIGHT, desired.height),
  };
  const accessible = areas.some(a => intersection(titlebar, a) >=
    Math.min(HEADER_WIDTH, desired.width) * Math.min(HEADER_HEIGHT, desired.height));
  const fitsSize = areas.some(a => desired.width <= a.width && desired.height <= a.height);
  if (accessible && fitsSize) return { bounds: desired, adjusted: note.w < MIN_WIDTH || note.h < MIN_HEIGHT, unavailable: false };

  // A negative virtual desktop coordinate is not inherently offscreen.
  // Pick the screen with greatest overlap; otherwise the nearest screen.
  const sorted = [...areas].sort((a, b) => {
    const overlap = intersection(desired, b) - intersection(desired, a);
    return overlap || distanceSquared(desired, a) - distanceSquared(desired, b);
  });
  const area = sorted[0];
  const width = Math.max(MIN_WIDTH, Math.min(desired.width, area.width));
  const height = Math.max(MIN_HEIGHT, Math.min(desired.height, area.height));
  const bounds = {
    x: clamp(desired.x, area.x, area.x + area.width - width),
    y: clamp(desired.y, area.y, area.y + area.height - height),
    width, height,
  };
  return { bounds, adjusted: !sameBounds(bounds, desired) || note.w < MIN_WIDTH || note.h < MIN_HEIGHT, unavailable: false };
}

class NoteGeometry {
  constructor({ screen, getNote, persist, warn = () => {}, schedule = setTimeout, cancel = clearTimeout, now = Date.now }) {
    this.screen = screen;
    this.getNote = getNote;
    this.persist = persist;
    this.warn = warn;
    this.schedule = schedule;
    this.cancel = cancel;
    this.now = now;
    this.windows = new Map();
    this.timer = null;
    this.topologyChangedAt = -Infinity;
    this.running = false;
  }

  displays() {
    const available = this.screen.getAllDisplays();
    const primary = typeof this.screen.getPrimaryDisplay === 'function'
      ? this.screen.getPrimaryDisplay() : null;
    return available.map(display => ({
      ...display,
      primary: primary ? display.id === primary.id : !!display.primary,
    }));
  }

  initial(note, index = 0) { return planNoteBounds(note, this.displays(), index).bounds; }

  start() {
    if (this.running) return;
    this.running = true;
    this.onDisplayChange = () => {
      this.topologyChangedAt = this.now();
      if (this.timer !== null) this.cancel(this.timer);
      this.timer = this.schedule(() => {
        this.timer = null;
        this.reflowAll();
      }, 300);
    };
    for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) {
      this.screen.on(event, this.onDisplayChange);
    }
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
    for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) {
      this.screen.removeListener(event, this.onDisplayChange);
    }
  }

  track(win, id) {
    const state = { id, manual: false, automatedUntil: -Infinity, automatedBounds: null };
    this.windows.set(win, state);
    win.on('will-move', () => { state.manual = true; });
    win.on('will-resize', () => { state.manual = true; });
    win.on('moved', () => this.capture(win));
    win.on('resized', () => this.capture(win));
    win.on('closed', () => { this.windows.delete(win); });
  }

  capture(win) {
    const state = this.windows.get(win);
    if (!state || win.isDestroyed()) return;
    const note = this.getNote(state.id);
    if (!note) return;
    const bounds = win.getBounds();
    const manual = state.manual;
    state.manual = false;
    if (!manual) {
      if (this.now() - this.topologyChangedAt < 1800) return;
      if (this.now() < state.automatedUntil && sameBounds(bounds, state.automatedBounds)) return;
      // Windows can relocate a window itself on unplug without will-move.
      // Don't accidentally overwrite a preferred off-monitor position.
      if (planNoteBounds(note, this.displays()).adjusted) return;
    }
    const patch = { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height };
    if (note.x === patch.x && note.y === patch.y && note.w === patch.w && note.h === patch.h) return;
    try { this.persist(state.id, patch); }
    catch (error) { this.warn(`Cannot persist note geometry: ${error.message}`); }
  }

  reflowAll() {
    const displays = this.displays();
    let i = 0;
    for (const [win, state] of this.windows) {
      const note = this.getNote(state.id);
      if (!note || win.isDestroyed()) continue;
      const result = planNoteBounds(note, displays, i++);
      if (result.unavailable) continue;
      const current = win.getBounds();
      if (sameBounds(current, result.bounds)) continue;
      // A new setBounds must not become a save event; the original screen
      // coordinates are retained for reconnection.
      state.automatedUntil = this.now() + 2000;
      state.automatedBounds = result.bounds;
      state.manual = false;
      try { win.setBounds(result.bounds); }
      catch (error) { this.warn(`Cannot restore note position: ${error.message}`); }
    }
  }
}

module.exports = { planNoteBounds, sameBounds, NoteGeometry };
