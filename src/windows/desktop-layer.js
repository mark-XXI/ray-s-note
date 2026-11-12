'use strict';

// Desktop notes must be actual children of Explorer's desktop view, not owned
// top-level windows. Ownership alone allows a note to rise above other apps.
// The Explorer desktop host is undocumented; failure is reported and callers
// must NOT show an unpinned note as a normal window.
class DesktopLayer {
  constructor({ adapter, warn = () => {} }) {
    this.adapter = adapter;
    this.warn = warn;
    this.attached = new Map();
    this.reportedMissing = false;
  }

  attach(win) {
    if (win.isDestroyed()) return false;
    try {
      const hwnd = this.adapter.noteHandle(win);
      const rawHost = this.adapter.findDesktopHost();
      const host = rawHost ? BigInt(rawHost) : 0n;
      if (!host) {
        if (!this.reportedMissing) this.warn('Explorer desktop view not found; desktop note cannot be shown safely.');
        this.reportedMissing = true;
        return false;
      }
      this.reportedMissing = false;
      const parent = this.adapter.getParent(hwnd);
      const record = this.attached.get(win);
      if (record) {
        // Never take ownership away from an unexpected external parent.
        if (parent !== record.host) {
          this.warn('Note parent changed outside Ray\'s Note; attachment skipped.');
          return false;
        }
        if (host === record.host) return true;
        this.adapter.rehostChild(hwnd, record.host, host);
        this.attached.set(win, { ...record, host });
        return true;
      }
      // A new Electron window is an unowned top-level window. Do not
      // reparent foreign/owned windows or windows already parented elsewhere.
      if (parent !== 0n) {
        this.warn('Note has an existing parent or owner; desktop attachment skipped.');
        return false;
      }
      const originalStyle = this.adapter.attachChild(hwnd, host);
      this.attached.set(win, { hwnd, host, originalStyle });
      return true;
    } catch (error) {
      this.warn(`Native desktop attachment failed: ${error.message}`);
      return false;
    }
  }

  ensure(win) { return this.attach(win); }

  detach(win) {
    const record = this.attached.get(win);
    if (!record) return true;
    try {
      if (!this.adapter.isWindow(record.hwnd)) return false;
      if (this.adapter.getParent(record.hwnd) !== record.host) {
        this.warn('Cannot detach a note with an unexpected parent.');
        return false;
      }
      this.adapter.detachChild(record.hwnd, record.host, record.originalStyle);
      // Keep the record until native restoration succeeds, so an error cannot
      // allow pinning to continue while the note is still a desktop child.
      this.attached.delete(win);
      return true;
    } catch (error) {
      this.warn(`Desktop detachment failed: ${error.message}`);
      return false;
    }
  }

  forget(win) {
    // The HWND has closed or may have been destroyed with Explorer. Never
    // attempt native operations on a stale or recycled native handle.
    this.attached.delete(win);
  }
}

module.exports = { DesktopLayer };
