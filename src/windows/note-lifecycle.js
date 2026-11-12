'use strict';

// Coordinates note visibility and deletion without importing Electron.
// Operations for the same note run in invocation order, even when a save
// acknowledgement is pending. This prevents Hide/Show/Delete races.
class NoteLifecycle {
  constructor({ getNote, listNotes, updateNote, removeNote, getWindow,
    openWindow, flushWindow, reportError, reportUnsaved, refresh }) {
    Object.assign(this, { getNote, listNotes, updateNote, removeNote,
      getWindow, openWindow, flushWindow, reportError, reportUnsaved, refresh });
    this.pending = new Map();
  }

  runExclusive(id, operation) {
    const previous = this.pending.get(id) || Promise.resolve();
    const current = previous.catch(() => {}).then(async () => {
      try { return await operation(); }
      catch (error) { this.reportError(error); return false; }
    });
    this.pending.set(id, current);
    void current.finally(() => {
      if (this.pending.get(id) === current) this.pending.delete(id);
    }).catch(() => {});
    return current;
  }

  // Used by shutdown so an in-flight Hide/Show/Delete finishes before
  // we request final editor saves. Does not start any extra operations.
  async whenIdle() {
    while (this.pending.size) {
      await Promise.allSettled([...this.pending.values()]);
    }
  }

  hide(id) {
    return this.runExclusive(id, async () => {
      const note = this.getNote(id);
      if (!note) return false;
      const win = this.getWindow(id);
      const alive = win && !win.isDestroyed();
      if (alive && !await this.flushWindow(win)) {
        this.reportUnsaved();
        return false;
      }
      // Write state before destroying the editor: failed writes never
      // make a note disappear without recording how to restore it.
      if (!note.hidden && !this.updateNote(id, { hidden: true })) return false;
      if (alive && !win.isDestroyed()) win.destroy();
      this.refresh();
      return true;
    });
  }

  show(id) {
    return this.runExclusive(id, async () => {
      const note = this.getNote(id);
      if (!note) return false;
      if (note.hidden && !this.updateNote(id, { hidden: false })) return false;
      const saved = this.getNote(id);
      const existing = this.getWindow(id);
      if (existing && !existing.isDestroyed()) {
        existing._userHide = false;
        existing.show();
        existing.focus();
      } else {
        this.openWindow(saved);
      }
      this.refresh();
      return true;
    });
  }

  delete(id) {
    return this.runExclusive(id, async () => {
      if (!this.getNote(id)) return false;
      // Deletion is explicit and confirmed by the dashboard; do not
      // overwrite a note with a delayed renderer save before deleting.
      if (!this.removeNote(id)) return false;
      const win = this.getWindow(id);
      if (win && !win.isDestroyed()) win.destroy();
      this.refresh();
      return true;
    });
  }

  async hideAll() {
    let ok = true;
    for (const note of [...this.listNotes()]) {
      if (!await this.hide(note.id)) ok = false;
    }
    return ok;
  }

  async showAll() {
    let ok = true;
    for (const note of [...this.listNotes()]) {
      if (!await this.show(note.id)) ok = false;
    }
    return ok;
  }
}

module.exports = { NoteLifecycle };
