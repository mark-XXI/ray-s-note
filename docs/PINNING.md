# Ray's Note — Pinning and Window Controls (Batch 08)

## Pin semantics

- **Pinned** (`pinned: true`): the note's Electron `BrowserWindow` uses native `alwaysOnTop` at the `floating` level. It stays over ordinary application windows. It is not attached to Windows Explorer or elevated over the taskbar/full-screen apps.
- **Unpinned** (`pinned: false`): the note is a normal focusable window with no always-on-top flag. This does not change its visibility or content.
- **Hidden pinned notes**: pin status is saved, but the window remains hidden. Showing the note later restores the on-top state.
- **Dashboard Pin/Unpin** and the note-titlebar pushpin control share the same operation and remain synchronized.
- **Pin changes** are persisted only after the native window accepts the change. On storage failure, the native change is rolled back (where supported).
- The desktop watcher still behaves as in Batch 07. True desktop attachment and Win+D semantics are deferred to Batch 09.

## Manual Windows verification

1. Open an unpinned note and focus Notepad. The note must not be forced above Notepad.
2. Pin that note from the note toolbar; focus Notepad again. The note remains above ordinary windows, without stealing keyboard focus when toggled.
3. Unpin from Dashboard. Focus Notepad; it can cover the note again. Confirm note control reflects unpinned state.
4. Pin from Dashboard while the note is visible. Confirm the note control updates without reopening the note.
5. Hide a pinned note, show it from Dashboard, confirm it remains pinned; close/reopen the application, confirm status persists.
6. Pin one note and leave another unpinned; the change must not affect the other note.
7. Verify checklist, bullets, multiline tasks, editing, auto-save, Hide All/Show All, tray Quit and reopen.
8. Confirm dashboard pinned count and pinned-filter actions remain correct after pin/unpin and restart.

## Scope notes

This is native z-order pinning, **not** Windows desktop-shell attachment. No `koffi` Win32 hooks are added in this batch. The patch does not change note serialization, dependencies, or Git configuration.
