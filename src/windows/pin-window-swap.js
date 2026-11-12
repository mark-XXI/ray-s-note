'use strict';

// Desktop child HWNDs can retain stale Chromium compositor state when reparented
// into top-level windows. An explicit note pin toggle may instead save the
// editor, persist the new state, then construct a NEW BrowserWindow in that
// state. No live HWND is reparented, and note data is never discarded on a
// failed flush or persistence operation.
class PinWindowSwap {
  constructor({ getNote, getWindow, flushWindow, persistPinned, openWindow,
    notify, reportUnsaved, reportError, schedule = (fn) => setTimeout(fn, 120) }) {
    Object.assign(this, { getNote, getWindow, flushWindow, persistPinned,
      openWindow, notify, reportUnsaved, reportError, schedule });
    this.pending = new Set();
  }

  isBusy(id) { return this.pending.has(id); }

  async toggle(id) {
    const note = this.getNote(id);
    const win = this.getWindow(id);
    if (!note || note.hidden || !win || win.isDestroyed()) {
      return { ok: false, error: 'No visible note window to switch' };
    }
    if (this.pending.has(id)) return { ok: false, error: 'Pin transition already in progress' };
    this.pending.add(id);
    let scheduled = false;
    let persisted = false;
    const previous = note.pinned === true;
    const pinned = !previous;
    try {
      if (!await this.flushWindow(win)) {
        this.reportUnsaved();
        return { ok: false, error: 'Could not save note before switching pin state' };
      }
      const current = this.getNote(id);
      if (!current || current.hidden || current.pinned !== previous ||
          win.isDestroyed() || this.getWindow(id) !== win) {
        return { ok: false, error: 'Note changed while switching pin state' };
      }
      // Storage is committed BEFORE any window is destroyed. Failure leaves
      // the old, fully interactive window unchanged.
      if (!this.persistPinned(id, pinned)) {
        return { ok: false, error: 'Could not save new pin state' };
      }
      persisted = true;
      this.notify(id, pinned);
      this.schedule(() => { void this.finish(id, win, previous, pinned); });
      scheduled = true;
      return { ok: true, pinned };
    } catch (error) {
      // Even a scheduling error cannot leave persisted pin state ahead of
      // the unchanged native window. Never destroy a window on this path.
      if (persisted && !scheduled) {
        try { if (this.persistPinned(id, previous)) this.notify(id, previous); }
        catch (rollbackError) { this.reportError(rollbackError); }
      }
      this.reportError(error);
      return { ok: false, error: 'Could not switch pin state' };
    } finally {
      if (!scheduled) this.pending.delete(id);
    }
  }

  async finish(id, win, previous, pinned) {
    try {
      // Give the IPC response time to reach the old renderer, and flush AGAIN
      // immediately before window destruction: a fast final edit is not lost.
      if (win.isDestroyed() || this.getWindow(id) !== win) return;
      if (!await this.flushWindow(win)) {
        this.reportUnsaved();
        if (this.persistPinned(id, previous)) this.notify(id, previous);
        else this.reportError(new Error('Could not restore pin state after failed editor flush'));
        return;
      }
      const note = this.getNote(id);
      if (!note || note.hidden || note.pinned !== pinned ||
          win.isDestroyed() || this.getWindow(id) !== win) return;
      // win.destroy() bypasses the normal Hide/Close handler. This does NOT
      // change note.hidden or delete any note. The existing closed listener
      // removes its HWND registry; openWindow builds a fresh correct native
      // hierarchy from note.pinned, preserving geometry and saved content.
      win.destroy();
      this.openWindow(this.getNote(id));
    } catch (error) {
      this.reportError(error);
    } finally {
      this.pending.delete(id);
    }
  }
}

module.exports = { PinWindowSwap };
