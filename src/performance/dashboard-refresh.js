'use strict';

// One refresh per short burst of note/window changes. This does not queue
// disk writes or affect the note-save acknowledgment path.
class DashboardRefresh {
  constructor({ send, isActive, schedule = setTimeout, cancel = clearTimeout, delay = 80 }) {
    if (typeof send !== 'function' || typeof isActive !== 'function') {
      throw new TypeError('DashboardRefresh needs send and isActive callbacks');
    }
    this.send = send;
    this.isActive = isActive;
    this.schedule = schedule;
    this.cancel = cancel;
    this.delay = delay;
    this.timer = null;
    this.stopped = false;
  }

  request() {
    if (this.stopped || !this.isActive() || this.timer !== null) return false;
    this.timer = this.schedule(() => {
      this.timer = null;
      if (!this.stopped && this.isActive()) this.send();
    }, this.delay);
    return true;
  }

  flush({ force = false } = {}) {
    const pending = this.timer !== null;
    if (pending) {
      this.cancel(this.timer);
      this.timer = null;
    }
    if (this.stopped || (!pending && !force) || !this.isActive()) return false;
    this.send();
    return true;
  }

  discard() {
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
  }

  stop() {
    this.stopped = true;
    this.discard();
  }
}

module.exports = { DashboardRefresh };
