'use strict';

// Persistent pin changes must match the native window's always-on-top state.
// The controller has no Electron dependency, so failure paths are unit-testable.
class NotePinning {
  constructor({ getNote, getWindow, persistPinned, notify, reportError, applyNativePinState }) {
    Object.assign(this, { getNote, getWindow, persistPinned, notify, reportError, applyNativePinState });
  }

  set(id, pinned) {
    const note = this.getNote(id);
    if (!note || typeof pinned !== 'boolean') {
      return { ok: false, error: 'Invalid note or pin state' };
    }

    const previous = note.pinned === true;
    const win = this.getWindow(id);
    const alive = Boolean(win && !win.isDestroyed());
    if (previous === pinned) {
      return { ok: true, pinned };
    }

    // Change the native state first. If this throws, persisted state is untouched.
    try {
      if (alive) {
        if (this.applyNativePinState) this.applyNativePinState(win, pinned);
        else win.setAlwaysOnTop(pinned, 'floating');
      }
    } catch (error) {
      this.reportError(error);
      return { ok: false, error: 'Could not change native pin state' };
    }

    // A persistence failure must undo the native change as far as possible.
    let persisted = false;
    try {
      persisted = this.persistPinned(id, pinned) === true;
    } catch (error) {
      this.reportError(error);
    }
    if (!persisted) {
      if (alive && !win.isDestroyed()) {
        try {
          if (this.applyNativePinState) this.applyNativePinState(win, previous);
          else win.setAlwaysOnTop(previous, 'floating');
        }
        catch (error) { this.reportError(error); }
      }
      return { ok: false, error: 'Could not save pin state' };
    }

    this.notify(id, pinned);
    return { ok: true, pinned };
  }

  toggle(id) {
    const note = this.getNote(id);
    if (!note) return { ok: false, error: 'Note does not exist' };
    return this.set(id, note.pinned !== true);
  }
}

module.exports = { NotePinning };
