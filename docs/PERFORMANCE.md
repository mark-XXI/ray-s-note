# Batch 15 — Performance without deferred note writes

## Changes
- Editor snapshots that validate successfully but do not alter content, color, font size, or text direction are acknowledged without replacing `notes.json` or advancing `updatedAt`.
- Note model patches that have no effective change are likewise skipped after validation.
- A note-ID index is rebuilt only after a successful atomic disk save or successful initial load. Failed saves leave both the live note collection and index unchanged.
- A visible dashboard receives at most one refresh per 80ms burst. Newly shown or restored-from-minimized dashboards get an immediate full snapshot. Hidden or closed dashboards schedule no updates. Outstanding UI timers are removed on window closure and orderly quit.

## Durability
**Actual changes are never queued for later disk persistence.** `NoteStore.save()` completes before the in-memory collection is replaced and before an editor success acknowledgment. The existing renderer flush handshake and hide/delete/quit serialization are unchanged.

## Windows acceptance
1. Create, edit, pin, unpin, hide, and restore several notes; verify dashboard counts update promptly.
2. Type rapidly in 10+ notes with dashboard open; verify there is no persistent lag or lost edit.
3. Make a change, close/hide the note quickly, reopen; verify text and geometry remain saved.
4. Press Win+D; unpinned notes remain on desktop. Pin/unpin still changes topmost mode.
5. Test real rounded corners, normal edge/corner resizing, color changes, keyboard shortcuts, and checklists.
6. Quit through tray and relaunch; verify all changed notes are intact.

No dependency, storage schema, Windows API, or new background polling was added.
