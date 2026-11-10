'use strict';

// Exact 16px corner radius without transparent BrowserWindow. Electron warns
// that transparent windows can lose native resizing on Windows. setShape is
// experimental and optional; a failure leaves the original rectangle intact.
const RADIUS = 16;

function roundedRects(width, height, radius = RADIUS) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return [];
  const r = Math.max(0, Math.min(radius, Math.floor(width / 2), Math.floor(height / 2)));
  if (!r) return [{ x: 0, y: 0, width, height }];
  const rects = [];
  for (let y = 0; y < r; y += 1) {
    // Pixel-centered circular curve; top and bottom are symmetrical.
    const dy = r - y - 0.5;
    const inset = Math.max(0, Math.min(r, Math.ceil(r - Math.sqrt(Math.max(0, r * r - dy * dy)))));
    const span = width - inset * 2;
    if (span > 0) {
      rects.push({ x: inset, y, width: span, height: 1 });
      rects.push({ x: inset, y: height - 1 - y, width: span, height: 1 });
    }
  }
  if (height > 2 * r) rects.push({ x: 0, y: r, width, height: height - 2 * r });
  return rects;
}

function installRoundedShape(win, { platform = process.platform, schedule = setTimeout,
  cancel = clearTimeout, warn = () => {} } = {}) {
  if (platform !== 'win32' || !win || typeof win.setShape !== 'function') return false;
  let pending = null;
  let closed = false;
  let lastSize = '';
  function apply() {
    pending = null;
    if (closed || win.isDestroyed()) return;
    try {
      const [width, height] = win.getContentSize();
      const key = `${width}x${height}`;
      if (key === lastSize) return;
      win.setShape(roundedRects(width, height));
      lastSize = key;
    } catch (error) {
      // Never block user edits, window moves, or desktop attachment.
      warn(error);
    }
  }
  function scheduleApply() {
    if (closed) return;
    if (pending !== null) cancel(pending);
    pending = schedule(apply, 60);
  }
  win.once('ready-to-show', apply);
  win.on('resize', scheduleApply);
  win.on('resized', scheduleApply);
  win.on('closed', () => {
    closed = true;
    if (pending !== null) cancel(pending);
    pending = null;
  });
  return true;
}

module.exports = { RADIUS, roundedRects, installRoundedShape };
