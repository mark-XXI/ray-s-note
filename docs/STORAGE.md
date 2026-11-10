# Batch 02 — Reliable Note Storage

## Changes

- Storage is loaded from the same existing `notes.json` location; no schema migration.
- Writes use a temporary file alongside the destination, sync file contents, and rename after a complete write. Temporary files are cleaned on ordinary failures.
- If `notes.json` is unreadable or malformed, launch is stopped with a visible error instead of silently creating an empty collection. Never overwrite that file while troubleshooting.
- The note editor waits for the main-process save result. A failed write shows an error, and closing a note through its red button does not continue until the editor has confirmed its pending changes.
- Quit from the tray asks every open note window to flush its pending changes; if any window fails or does not respond within 8 seconds, Quit is cancelled.
- No backup copies are created. Temporary files are only used for in-progress atomic replacement. Git does not track your AppData notes, so do not assume Git rollback restores them.

## Commands (PowerShell at repository root)

```powershell
npm test
npm run test:syntax
npm run start:test
```

## Manual Windows tests (use only isolated `npm run start:test` profile)

1. Type text, immediately close with the note's red button, reopen from Dashboard, and verify the latest text.
2. Type text, immediately use **Quit Ray's Note** in the tray, relaunch, and verify the latest text.
3. Create two notes, edit both, immediately Quit from the tray, and verify both after relaunch.
4. Change note color and font size, immediately Quit, and verify both settings after relaunch.
5. Type into a note, immediately click **Dashboard > Hide**, then Show and verify text. Test New, Show/Hide, Pin/Unpin and Delete after relaunch. Other window semantics are scheduled for later batches.
6. Confirm ordinary `npm start` still uses the standard profile and `npm run start:test` uses `.rays-note-test-data` (do not edit real notes).
7. Malformed JSON and failed writes are covered by isolated automated tests. Do not deliberately corrupt real notes or the GUI test profile. On malformed JSON, startup must stop without overwriting the file.

## Scope limitations

- This is a storage-focused batch. It does not yet harden all IPC permissions or solve desktop pinning.
- External OS shutdown, forced process termination, and renderer crashes may still interrupt unsent 700ms edits. A later lifecycle batch will cover additional shutdown conditions.
- Atomic rename protects against partially written destination files on normal write errors. It is not a guarantee against every power-loss, filesystem, or hardware failure.
- The save status only tracks the latest main-process write; it does not cover disk hardware failures after an acknowledged write.

## Commit gate

- All automated tests green; JavaScript parses successfully.
- Manual Windows tests 1–5 pass; record defects separately if any fail.
- `git diff --check` passes, staged diff reviewed, and no unrelated paths staged.
- User commits using `fix(storage): implement safe persistence and recovery`.
