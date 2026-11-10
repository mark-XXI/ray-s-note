'use strict';

// Show Desktop (Win+D) may minimize ordinary windows, then move Explorer's
// desktop above other windows. Restore only on a minimize event rather than
// polling every open note 6+ times each second. No Explorer reparenting.
// This is a best-effort recovery, not guaranteed true desktop attachment.
function startDesktopWatcher(win, options = {}) {
  const {
    enabled = true,
    delayMs = 350,
    schedule = setTimeout,
    cancel = clearTimeout,
    shouldRestore = () => true,
    onError = () => {},
  } = options;

  let active = enabled === true;
  let stopped = false;
  let timer = null;
  // Previous lifecycle code explicitly sets this to false on Show.
  win._userHide = false;

  function clearPending() {
    if (timer !== null) {
      cancel(timer);
      timer = null;
    }
  }

  function canRestore() {
    return !stopped && active && !win.isDestroyed() &&
      !win._userHide && shouldRestore() === true;
  }

  function attemptRestore() {
    timer = null;
    if (!canRestore() || !win.isMinimized()) return;
    try {
      // Restore does not set topmost or change saved pin/visibility flags.
      // We never call focus(), show(), or moveTop() during automatic recovery.
      win.restore();
    } catch (error) {
      onError(error);
    }
  }

  function queueRestore() {
    if (timer !== null || !canRestore() || !win.isMinimized()) return;
    timer = schedule(attemptRestore, delayMs);
  }

  function onHide() {
    // Explicit win.hide() is not a Windows minimize. Don't resurrect it.
    if (!win.isMinimized()) clearPending();
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    clearPending();
    win.removeListener('minimize', queueRestore);
    win.removeListener('restore', clearPending);
    win.removeListener('hide', onHide);
    win.removeListener('closed', stop);
  }

  win.on('minimize', queueRestore);
  win.on('restore', clearPending);
  win.on('hide', onHide);
  win.on('closed', stop);

  return {
    setEnabled(value) {
      if (stopped) return;
      active = value === true;
      if (!active) clearPending();
      else queueRestore();
    },
    stop,
  };
}

module.exports = { startDesktopWatcher };
