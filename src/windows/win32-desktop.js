'use strict';

// Explorer's desktop view is undocumented. This adapter deliberately fails
// closed on unsupported platforms and keeps all HWND changes transactional.
// Children of the desktop view remain behind ordinary top-level windows even
// if focused; a pinned note is restored to an independent top-level window.
function createWindowsDesktopAdapter({ koffiModule, platform = process.platform, arch = process.arch } = {}) {
  if (platform !== 'win32' || arch !== 'x64') {
    throw new Error('Native desktop attachment requires Windows x64');
  }
  const koffi = koffiModule || require('koffi');
  const user32 = koffi.load('user32.dll');
  const FindWindowExW = user32.func('uint64_t __stdcall FindWindowExW(uint64_t parent, uint64_t after, const char16_t *className, const char16_t *windowName)');
  const EnumProc = koffi.proto('int __stdcall DesktopEnumProc(uint64_t hwnd, intptr_t data)');
  const EnumWindows = user32.func('int __stdcall EnumWindows(DesktopEnumProc *callback, intptr_t data)');
  const IsWindow = user32.func('int __stdcall IsWindow(uint64_t hwnd)');
  const GetWindowLongPtrW = user32.func('int64_t __stdcall GetWindowLongPtrW(uint64_t hwnd, int index)');
  const SetWindowLongPtrW = user32.func('int64_t __stdcall SetWindowLongPtrW(uint64_t hwnd, int index, int64_t value)');
  const SetParent = user32.func('uint64_t __stdcall SetParent(uint64_t hwnd, uint64_t parent)');
  const SetWindowPos = user32.func('int __stdcall SetWindowPos(uint64_t hwnd, uint64_t after, int x, int y, int width, int height, uint32_t flags)');
  const RegisterWindowMessageW = user32.func('uint32_t __stdcall RegisterWindowMessageW(const char16_t *name)');
  koffi.struct('RaysDesktopRect', { left: 'int32_t', top: 'int32_t', right: 'int32_t', bottom: 'int32_t' });
  koffi.struct('RaysDesktopPoint', { x: 'int32_t', y: 'int32_t' });
  const GetWindowRect = user32.func('int __stdcall GetWindowRect(uint64_t hwnd, _Out_ RaysDesktopRect *rect)');
  const ScreenToClient = user32.func('int __stdcall ScreenToClient(uint64_t hwnd, _Inout_ RaysDesktopPoint *point)');
  const GWLP_HWNDPARENT = -8;
  const GWL_STYLE = -16;
  const WS_CHILD = 0x40000000n;
  const WS_POPUP = 0x80000000n;
  const SWP_NOACTIVATE = 0x0010;
  const SWP_NOZORDER = 0x0004;
  const SWP_FRAMECHANGED = 0x0020;

  function noteHandle(win) {
    const bytes = win.getNativeWindowHandle();
    if (!Buffer.isBuffer(bytes) || bytes.length < 8) throw new Error('Invalid native window handle');
    const hwnd = bytes.readBigUInt64LE(0);
    if (!hwnd) throw new Error('Empty note HWND');
    return hwnd;
  }

  function valid(hwnd) { return Boolean(hwnd && IsWindow(hwnd)); }
  function getParent(hwnd) {
    if (!valid(hwnd)) throw new Error('Invalid note HWND');
    // GWLP_HWNDPARENT means parent for WS_CHILD, owner for top-level windows.
    return BigInt(GetWindowLongPtrW(hwnd, GWLP_HWNDPARENT));
  }
  function getStyle(hwnd) {
    if (!valid(hwnd)) throw new Error('Invalid note HWND');
    return BigInt.asUintN(32, BigInt(GetWindowLongPtrW(hwnd, GWL_STYLE)));
  }
  function setStyle(hwnd, value) {
    SetWindowLongPtrW(hwnd, GWL_STYLE, BigInt.asIntN(32, value));
    if (getStyle(hwnd) !== BigInt.asUintN(32, value)) throw new Error('Windows rejected note window style');
  }
  function setParent(hwnd, host) {
    SetParent(hwnd, host);
    // SetParent can return zero on SUCCESS if the original parent was null.
    if (getParent(hwnd) !== BigInt(host)) throw new Error('Windows rejected desktop window parent');
  }
  function rect(hwnd) {
    const r = {};
    if (!GetWindowRect(hwnd, r)) throw new Error('Could not read note screen coordinates');
    return { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top };
  }
  function localPoint(host, r) {
    const point = { x: r.x, y: r.y };
    if (!ScreenToClient(host, point)) throw new Error('Could not map note onto desktop coordinates');
    return point;
  }
  function reposition(hwnd, r, host = 0n) {
    const p = host ? localPoint(host, r) : r;
    // For desktop children, insert at the top of desktop-view child siblings
    // (above icons), never at the top of the normal application window stack.
    const flags = SWP_NOACTIVATE | SWP_FRAMECHANGED | (host ? 0 : SWP_NOZORDER);
    if (!SetWindowPos(hwnd, 0n, p.x, p.y, r.width, r.height, flags)) {
      throw new Error('Could not preserve note position during desktop transition');
    }
  }

  function findDesktopHost() {
    let found = 0n;
    EnumWindows((topLevel) => {
      const view = FindWindowExW(topLevel, 0, 'SHELLDLL_DefView', null);
      if (valid(view)) { found = BigInt(view); return 0; }
      return 1;
    }, 0);
    return found || null;
  }

  function attachChild(hwnd, host) {
    if (!valid(hwnd) || !valid(host)) throw new Error('Invalid desktop or note window');
    if (getParent(hwnd) !== 0n) throw new Error('Note already has a parent or owner');
    const originalStyle = getStyle(hwnd);
    if ((originalStyle & WS_CHILD) !== 0n) throw new Error('Note is already a child window');
    const originalRect = rect(hwnd);
    // Compute coordinates before changing the HWND hierarchy.
    const position = localPoint(host, originalRect);
    try {
      setStyle(hwnd, (originalStyle & ~WS_POPUP) | WS_CHILD);
      setParent(hwnd, host);
      if (!SetWindowPos(hwnd, 0n, position.x, position.y,
        originalRect.width, originalRect.height, SWP_NOACTIVATE | SWP_FRAMECHANGED)) {
        throw new Error('Could not place note on the desktop');
      }
      return originalStyle;
    } catch (error) {
      // Best-effort rollback: do not leave a half-parented normal window.
      try { if (valid(hwnd) && getParent(hwnd) === host) setParent(hwnd, 0n); } catch {}
      try { if (valid(hwnd)) setStyle(hwnd, originalStyle); } catch {}
      try { if (valid(hwnd)) reposition(hwnd, originalRect); } catch {}
      throw error;
    }
  }

  function detachChild(hwnd, host, originalStyle) {
    if (!valid(hwnd) || getParent(hwnd) !== host) throw new Error('Unexpected desktop parent');
    const previousRect = rect(hwnd);
    const childStyle = getStyle(hwnd);
    try {
      setParent(hwnd, 0n);
      setStyle(hwnd, originalStyle);
      reposition(hwnd, previousRect);
    } catch (error) {
      try {
        if (valid(hwnd)) {
          setStyle(hwnd, childStyle);
          setParent(hwnd, host);
          reposition(hwnd, previousRect, host);
        }
      } catch {}
      throw error;
    }
  }

  function rehostChild(hwnd, oldHost, newHost) {
    if (!valid(hwnd) || !valid(newHost) || getParent(hwnd) !== oldHost) {
      throw new Error('Unexpected parent during Explorer desktop refresh');
    }
    const previousRect = rect(hwnd);
    const position = localPoint(newHost, previousRect);
    try {
      setParent(hwnd, newHost);
      if (!SetWindowPos(hwnd, 0n, position.x, position.y,
        previousRect.width, previousRect.height, SWP_NOACTIVATE | SWP_FRAMECHANGED)) {
        throw new Error('Could not restore desktop note position');
      }
    } catch (error) {
      try { if (valid(hwnd) && valid(oldHost)) {
        setParent(hwnd, oldHost);
        reposition(hwnd, previousRect, oldHost);
      } } catch {}
      throw error;
    }
  }

  return {
    noteHandle,
    isWindow: valid,
    findDesktopHost,
    getParent,
    attachChild,
    detachChild,
    rehostChild,
    registerTaskbarCreated: () => RegisterWindowMessageW('TaskbarCreated'),
  };
}

module.exports = { createWindowsDesktopAdapter };
