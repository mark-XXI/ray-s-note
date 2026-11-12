# Ray's Note — Native desktop layer (Batch 10)

## Desired behavior

- **Unpinned** notes should be visible with Win+D, sitting in the desktop layer behind normal application windows.
- **Pinned** notes remain normal native topmost windows above ordinary applications.
- The dashboard stays a normal window. No manual recovery controls appear in the tray.
- Editor content, note geometry, persisted `pinned`/`hidden`, and tray commands retain their prior meanings.

## Implementation

The unpinned desktop owner is the Windows Explorer `WorkerW` found by querying `Progman`, sending the undocumented `0x052C` message with a short timeout, then finding the `WorkerW` adjacent to `SHELLDLL_DefView`. A top-level Electron HWND is linked using `SetWindowLongPtrW(GWLP_HWNDPARENT)`, **not SetParent**, so screen coordinates, editing, and native Chromium composition are preserved.

A pinned note is detached from WorkerW before enabling `setAlwaysOnTop`. Unpinning restores desktop ownership. The native action occurs before the existing pin-state save; storage failure triggers a rollback. Explorer `TaskbarCreated` broadcasts trigger a deferred reattachment attempt. No automatic minimize/restore loops or tray recovery options remain.

**Limitations:** `Progman`/`WorkerW` shell windows and message `0x052C` are undocumented. Behavior can differ between Windows builds, DPI configurations, virtual desktops, and Explorer restarts. If the host cannot be found or native binding fails, Ray's Note logs a warning and leaves normal usable note windows. **Windows GUI verification is mandatory** before release; automated tests use a mocked native adapter and cannot prove Win+D works.

## Test cases (Windows x64)

1. Unpin one note and press Win+D. Note remains on wallpaper and can be edited, while an ordinary window covers it.
2. Repeat Win+D twice (toggle Show Desktop back). Ensure no duplicates, focus theft, or unexpected minimizing.
3. Pin the note; it should remain above Notepad. Unpin; it should return to the desktop layer.
4. Hide, show, and restart notes with mixed pin states. No hidden note resurrects.
5. Drag and resize an unpinned note; restart and verify placement and dimensions.
6. Verify the dashboard and tray remain accessible and contain no manual recovery option.
7. Test Explorer restart via Task Manager (optional, **after saving notes**); confirm existing or reopened note windows are functional.
8. On unsupported systems, check for the expected normal-window fallback rather than a crash.

If Win+D doesn't work, send the terminal log and a screenshot. Do not assume the native integration works solely because automated tests pass.
