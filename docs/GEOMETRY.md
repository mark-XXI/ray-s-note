# Ray's Note — Batch 11: Geometry and Display Changes

## Design

Window bounds in Electron (`screen` and `BrowserWindow`) use device-independent pixels (DIP); do not multiply by monitor DPI scale. Work with each display's `workArea`, not a primary-display-only width/height. Coordinates can be negative when the second display is left of or above the primary.

A note's saved `x`, `y`, `w`, and `h` are the user's preferred rectangle. If a monitor disappears or the work area shrinks, reposition/resize the **open native window only** until it is reachable; **do not overwrite `notes.json`** as a side effect of system display changes. When the original monitor returns, reapply the stored rectangle. Only intentional user moves/resizes save new geometry.

### User behavior

- Newly created notes appear inside the primary display's available work area, with a small cascade.
- Existing notes keep their position across mixed-scale screens when the titlebar is accessible.
- Missing screens cause a temporary visual relocation to an available work area, with the saved position intact.
- Dragging or resizing a note on the fallback monitor deliberately changes its preferred position.
- Work-area, rotation, resolution, and monitor-connect events reflow open notes through a short coalesced event callback.
- Desktop `WorkerW` ownership, topmost pinning, hidden-state handling, checklists, and content persistence remain unchanged.

## Windows manual tests

1. Open notes on the primary screen; drag/resize; restart and verify size/position.
2. Open a note on a left-of-primary display (negative coordinates); quit/relaunch; verify placement.
3. Disconnect the display while the application runs; note becomes reachable on primary.
4. Reconnect without moving the fallback note; it should return to the saved external-monitor location.
5. Disconnect, deliberately drag the fallback note, reconnect; note should now stay in its new location.
6. Change Windows display scaling, resolution, and taskbar/work-area layout; confirm notes remain reachable.
7. Verify pinned notes stay topmost and unpinned notes remain on the wallpaper layer after Win+D.
8. Check editor, checklists, dashboard, hide/restore, tray Quit, and stored content.

On a single-monitor PC, test display scaling and screen resolution; external-monitor checks may be marked N/A. Do not test by editing real `notes.json`; use `npm run start:test`.

## Limitations

- Automatic relocation without explicit user input is deliberately not written to disk; this prevents destructive moves after monitor loss.
- Electron's display events can be delayed while Windows changes the topology; the implementation coalesces them.
- The Explorer desktop attachment depends on an undocumented shell hierarchy; this batch does not alter it.
