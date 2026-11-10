'use strict';

// The desktop host API is not public Windows API surface. Use only on Windows
// x64 and fail closed on unsupported systems, never altering stored notes.
function createWindowsDesktopAdapter({ koffiModule } = {}) {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('Native desktop attachment requires Windows x64');
  }
  const koffi = koffiModule || require('koffi');
  const user32 = koffi.load('user32.dll');
  const FindWindowW = user32.func('uint64_t __stdcall FindWindowW(const char16_t *className, const char16_t *windowName)');
  const FindWindowExW = user32.func('uint64_t __stdcall FindWindowExW(uint64_t parent, uint64_t after, const char16_t *className, const char16_t *windowName)');
  const SendMessageTimeoutW = user32.func('uint64_t __stdcall SendMessageTimeoutW(uint64_t hwnd, uint32_t message, uint64_t wparam, int64_t lparam, uint32_t flags, uint32_t timeout, _Out_ uint64_t *result)');
  const EnumProc = koffi.proto('int __stdcall DesktopEnumProc(uint64_t hwnd, intptr_t data)');
  const EnumWindows = user32.func('int __stdcall EnumWindows(DesktopEnumProc *callback, intptr_t data)');
  const IsWindow = user32.func('int __stdcall IsWindow(uint64_t hwnd)');
  const GetWindowLongPtrW = user32.func('int64_t __stdcall GetWindowLongPtrW(uint64_t hwnd, int index)');
  const SetWindowLongPtrW = user32.func('int64_t __stdcall SetWindowLongPtrW(uint64_t hwnd, int index, int64_t newValue)');
  const RegisterWindowMessageW = user32.func('uint32_t __stdcall RegisterWindowMessageW(const char16_t *name)');
  const GWLP_HWNDPARENT = -8;

  // Electron returns a native HWND stored in a little-endian pointer Buffer.
  function noteHandle(win) {
    const bytes = win.getNativeWindowHandle();
    if (!Buffer.isBuffer(bytes) || bytes.length < 8) throw new Error('Invalid native window handle');
    const value = bytes.readBigUInt64LE(0);
    if (!value) throw new Error('Empty native window handle');
    return value;
  }

  function valid(hwnd) { return Boolean(hwnd && IsWindow(hwnd)); }

  function scanWorker() {
    let found = null;
    EnumWindows((window) => {
      const iconView = FindWindowExW(window, 0, 'SHELLDLL_DefView', null);
      if (iconView && valid(iconView)) {
        const next = FindWindowExW(0, window, 'WorkerW', null);
        if (valid(next)) { found = next; return 0; }
      }
      return 1;
    }, 0);
    return found;
  }

  function findWorker() {
    const progman = FindWindowW('Progman', null);
    if (!valid(progman)) return null;
    // Avoid repeatedly sending undocumented messages when the shell layer
    // already exists. Request the WorkerW only when Explorer has none.
    const existing = scanWorker();
    if (existing) return existing;
    try { SendMessageTimeoutW(progman, 0x052c, 0, 0, 0x0002, 250, [0]); }
    catch { /* Normal fallback below; no infinite retries. */ }
    return scanWorker();
  }

  function getOwner(hwnd) {
    if (!valid(hwnd)) throw new Error('Invalid note HWND');
    return BigInt(GetWindowLongPtrW(hwnd, GWLP_HWNDPARENT));
  }

  function setOwner(hwnd, owner) {
    if (!valid(hwnd) || (owner && !valid(owner))) throw new Error('Invalid desktop owner HWND');
    SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, owner || 0);
    // SetWindowLongPtr may return zero for a successful change from no owner.
    // Verify by reading the owner, rather than misinterpreting zero as failure.
    if (getOwner(hwnd) !== BigInt(owner || 0)) throw new Error('Windows rejected desktop owner');
  }

  return {
    noteHandle,
    isWindow: valid,
    findWorker,
    getOwner,
    setOwner,
    registerTaskbarCreated: () => RegisterWindowMessageW('TaskbarCreated'),
  };
}

module.exports = { createWindowsDesktopAdapter };
