'use strict';

// An unpinned note is owned by the Explorer desktop WorkerW rather than
// constantly restored after Win+D. This retains a top-level HWND and its
// screen-space coordinates (unlike SetParent / WS_CHILD reparenting).
// The WorkerW method is undocumented; inability to attach is nonfatal.
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
      const rawWorker = this.adapter.findWorker();
      const worker = rawWorker ? BigInt(rawWorker) : 0n;
      if (!worker) {
        if (!this.reportedMissing) this.warn('Explorer WorkerW was not found; normal window fallback is active.');
        this.reportedMissing = true;
        return false;
      }
      this.reportedMissing = false;
      const current = this.adapter.getOwner(hwnd);
      const remembered = this.attached.get(win);
      if (remembered && current === worker && remembered.worker === worker) return true;
      // Never silently replace an unexpected owner: only untouched windows or
      // windows we previously attached are managed by this controller.
      if (!remembered && current !== 0n) {
        this.warn('Note has an existing owner; desktop attachment skipped.');
        return false;
      }
      if (remembered && current !== remembered.worker && current !== remembered.original) {
        this.warn('Owner was changed externally; desktop attachment skipped.');
        return false;
      }
      const original = remembered ? remembered.original : current;
      this.adapter.setOwner(hwnd, worker);
      this.attached.set(win, { hwnd, worker, original });
      return true;
    } catch (error) {
      this.warn(`Native desktop attachment failed: ${error.message}`);
      return false;
    }
  }

  ensure(win) {
    if (win.isDestroyed()) return false;
    return this.attach(win);
  }

  detach(win) {
    const record = this.attached.get(win);
    if (!record) return true;
    this.attached.delete(win);
    try {
      if (this.adapter.isWindow(record.hwnd) &&
          this.adapter.getOwner(record.hwnd) === record.worker) {
        this.adapter.setOwner(record.hwnd, record.original);
      }
      return true;
    } catch (error) {
      this.warn(`Desktop detachment failed: ${error.message}`);
      return false;
    }
  }

  forget(win) {
    // Closed window HWNDs are invalid; never attempt restoring a dead HWND.
    this.attached.delete(win);
  }
}

module.exports = { DesktopLayer };
