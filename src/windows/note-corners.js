'use strict';

// Electron's CSS radius only rounds the web page; the opaque native HWND remains
// rectangular on some Windows/Explorer combinations. The GDI region clips the
// physical window. Clear it before user resizing and restore it only once the
// resize ends, so the native WS_THICKFRAME hit testing stays intact.
//
// This never touches persisted notes and does not rely on transparency or
// Electron setShape. Native failures leave a normal resizable rectangle.
const RADIUS_DIP = 8;

function createCornerAdapter({ koffiModule } = {}) {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('Native rounded corners require Windows x64');
  }
  const koffi = koffiModule || require('koffi');
  const user32 = koffi.load('user32.dll');
  const gdi32 = koffi.load('gdi32.dll');
  koffi.struct('RaysNoteCornerRect', {
    left: 'int32_t', top: 'int32_t', right: 'int32_t', bottom: 'int32_t',
  });
  const GetWindowRect = user32.func('int __stdcall GetWindowRect(uint64_t hwnd, _Out_ RaysNoteCornerRect *rect)');
  const SetWindowRgn = user32.func('int __stdcall SetWindowRgn(uint64_t hwnd, uint64_t region, int redraw)');
  const CreateRoundRectRgn = gdi32.func('uint64_t __stdcall CreateRoundRectRgn(int left, int top, int right, int bottom, int ellipseWidth, int ellipseHeight)');
  const DeleteObject = gdi32.func('int __stdcall DeleteObject(uint64_t object)');
  let GetDpiForWindow = null;
  try { GetDpiForWindow = user32.func('uint32_t __stdcall GetDpiForWindow(uint64_t hwnd)'); }
  catch { /* Older Windows; use 96 DPI. */ }

  function handle(win) {
    const buffer = win.getNativeWindowHandle();
    if (!Buffer.isBuffer(buffer) || buffer.length < 8) throw new Error('Invalid note HWND');
    const hwnd = buffer.readBigUInt64LE(0);
    if (hwnd === 0n) throw new Error('Empty note HWND');
    return hwnd;
  }

  return {
    apply(win, radiusDip = RADIUS_DIP) {
      const hwnd = handle(win);
      const rect = {};
      if (!GetWindowRect(hwnd, rect)) throw new Error('Cannot read note window dimensions');
      const width = rect.right - rect.left;
      const height = rect.bottom - rect.top;
      if (width < 40 || height < 40) return false;
      let dpi = 96;
      try { if (GetDpiForWindow) dpi = GetDpiForWindow(hwnd) || 96; }
      catch { /* Windows DPI API unavailable. */ }
      const radius = Math.max(2, Math.round(radiusDip * dpi / 96));
      const region = CreateRoundRectRgn(0, 0, width + 1, height + 1, radius * 2, radius * 2);
      if (!region) throw new Error('Could not create native rounded region');
      // A successful SetWindowRgn transfers ownership of HRGN to Windows.
      if (!SetWindowRgn(hwnd, region, 1)) {
        DeleteObject(region);
        throw new Error('Windows rejected the rounded region');
      }
      return true;
    },
    clear(win) {
      return Boolean(SetWindowRgn(handle(win), 0n, 1));
    },
  };
}

function installNoteCorners(win, { adapter, warn = () => {}, schedule = setTimeout,
  cancel = clearTimeout } = {}) {
  if (!adapter) return { supported: false, dispose() {} };
  let closed = false;
  let resizing = false;
  let pending = null;
  let disabled = false;

  const clearPending = () => {
    if (pending !== null) { cancel(pending); pending = null; }
  };
  const report = (error) => {
    disabled = true;
    clearPending();
    try { if (!win.isDestroyed()) adapter.clear(win); }
    catch { /* The normal rectangular window remains usable. */ }
    warn(error);
  };
  const apply = () => {
    clearPending();
    if (closed || disabled || resizing || win.isDestroyed()) return;
    try { if (!adapter.apply(win, RADIUS_DIP)) report(new Error('Rounded region unavailable')); }
    catch (error) { report(error); }
  };
  const beforeResize = () => {
    if (closed || disabled || resizing || win.isDestroyed()) return;
    resizing = true;
    clearPending();
    try { if (!adapter.clear(win)) throw new Error('Could not clear region before resizing'); }
    catch (error) { report(error); }
  };
  const onResize = () => {
    if (closed || disabled || resizing) return;
    clearPending();
    // Programmatic resizing lacks will-resize / resized. Debounce only that case.
    pending = schedule(() => { pending = null; apply(); }, 120);
  };
  const afterResize = () => { if (closed || disabled) return; resizing = false; apply(); };
  const dispose = () => {
    closed = true;
    clearPending();
    win.removeListener('will-resize', beforeResize);
    win.removeListener('resize', onResize);
    win.removeListener('resized', afterResize);
    win.removeListener('closed', dispose);
    // Window destruction owns and frees its last successful GDI region.
  };
  win.on('will-resize', beforeResize);
  win.on('resize', onResize);
  win.on('resized', afterResize);
  win.on('closed', dispose);
  return { supported: true, apply, dispose };
}

module.exports = { RADIUS_DIP, createCornerAdapter, installNoteCorners };
