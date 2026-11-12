'use strict';

// Desktop-only notes are WS_CHILD windows under Explorer's desktop view.
// Explorer can retain keyboard focus even after Chromium receives a click.
// Only the note's editor/title explicitly request this narrowly-scoped repair.
// No SetParent, window styles, Z order, input simulation, or background timers.
function createDesktopEditorFocus({ koffiModule, platform = process.platform, arch = process.arch } = {}) {
  if (platform !== 'win32' || arch !== 'x64') {
    throw new Error('Desktop editor focus requires Windows x64');
  }
  const koffi = koffiModule || require('koffi');
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');
  const IsWindow = user32.func('int __stdcall IsWindow(uint64_t hwnd)');
  const IsChild = user32.func('int __stdcall IsChild(uint64_t parent, uint64_t child)');
  const GetForegroundWindow = user32.func('uint64_t __stdcall GetForegroundWindow()');
  const GetWindowThreadProcessId = user32.func('uint32_t __stdcall GetWindowThreadProcessId(uint64_t hwnd, uint64_t processId)');
  const AttachThreadInput = user32.func('int __stdcall AttachThreadInput(uint32_t a, uint32_t b, int attach)');
  const SetFocus = user32.func('uint64_t __stdcall SetFocus(uint64_t hwnd)');
  const GetFocus = user32.func('uint64_t __stdcall GetFocus()');
  const GetCurrentThreadId = kernel32.func('uint32_t __stdcall GetCurrentThreadId()');

  function focusEditor(win, desktopHost) {
    if (!win || win.isDestroyed() || !desktopHost) return false;
    const handle = win.getNativeWindowHandle();
    if (!Buffer.isBuffer(handle) || handle.length < 8) return false;
    const hwnd = handle.readBigUInt64LE(0);
    const host = BigInt(desktopHost);
    if (!hwnd || !IsWindow(hwnd) || !IsWindow(host) || !IsChild(host, hwnd)) return false;

    const foreground = BigInt(GetForegroundWindow());
    if (!foreground || !IsWindow(foreground)) return false;
    const noteThread = GetWindowThreadProcessId(hwnd, 0n);
    const foregroundThread = GetWindowThreadProcessId(foreground, 0n);
    const currentThread = GetCurrentThreadId();
    if (!noteThread || !foregroundThread || !currentThread) return false;

    const attached = [];
    let focusReached = false;
    let detached = true;
    try {
      // Input queues are joined only for the current editor pointer event.
      // NEVER leave an Explorer/Electron pair intentionally attached.
      for (const thread of new Set([noteThread, foregroundThread])) {
        if (thread === currentThread) continue;
        if (!AttachThreadInput(currentThread, thread, 1)) return false;
        attached.push(thread);
      }
      SetFocus(hwnd); // NULL return can mean no previously focused window.
      const actual = BigInt(GetFocus());
      focusReached = actual === hwnd || Boolean(actual && IsChild(hwnd, actual));
    } finally {
      for (const thread of attached.reverse()) {
        try { if (!AttachThreadInput(currentThread, thread, 0)) detached = false; }
        catch { detached = false; }
      }
      if (!detached) throw new Error('Could not detach temporary GUI input queues');
    }
    return focusReached;
  }

  return { focusEditor };
}

module.exports = { createDesktopEditorFocus };
