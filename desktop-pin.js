'use strict';

// Simplest possible approach: poll win.isMinimized() every 150ms.
// If Show Desktop minimizes our window, we catch it and restore.
// No koffi needed.

function startDesktopWatcher(win) {
  win._userHide = false;

  const id = setInterval(() => {
    if (win.isDestroyed()) { clearInterval(id); return; }
    if (!win._userHide && win.isMinimized()) {
      win.restore();
    }
  }, 150);

  win.on('closed', () => clearInterval(id));
}

module.exports = { startDesktopWatcher };
