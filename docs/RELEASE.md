# Ray's Note — Windows x64 release (Batch 16)

## Release scope and data preservation

- Source baseline: `db641d7` on `fix/rays-note-full-stabilization`.
- Existing app identity is retained: package `rays-note`, product name `Ray Notes`, app ID `com.rays.note`, version `2.0.0`. Do not rename those without an intentional, tested user-data migration.
- Both packaged binaries are **unsigned** unless your own signing environment supplies a trusted certificate. Windows SmartScreen warnings are possible. Do not bypass security warnings blindly.
- `npm run build` only creates artifacts under `dist/`; it **does not install or publish** them.
- The default user-data location is decided by Electron's runtime app name. The development profile, an existing installed release, and the new installer may use different directories. **No automatic data migration is performed.** An initially blank packaged app does not mean older notes were deleted.
- Uninstalling the NSIS package is configured **not** to delete app data. Do not assume this protects against unrelated manual folder deletion.
- There are no auto-updaters, background downloads or silent installation actions in this batch.

## Prerequisites

- Windows x64, PowerShell 5.1+, Node.js 22.x and npm 10.x (based on source audit).
- Internet connection for a first `npm ci` and Electron/electron-builder build downloads.
- Close all running Ray's Note instances, including tray instances, before manual installation testing.
- Work on the clean feature branch, not on a production data directory.

## Build steps (run in repo root)

```powershell
npm ci
npm run release:preflight
npm run build
npm run release:verify
```

`npm ci` changes only local development dependencies under `node_modules/`; it does not intentionally modify tracked source or application notes. If an npm or builder download/build fails, **stop**; do not manually copy random binaries into the release.

`release:preflight` runs the full test suite, syntax tests and checks the installed native `koffi` module on Windows x64. `release:verify` checks output filenames, PE headers, unpacked Electron resources and `koffi` native `.node` files. It writes a SHA-256 manifest under `dist/`. These are structural checks, not a Windows GUI smoke test or a security/code-signing audit.

## Expected output files

- `dist/RayNotes-Setup-2.0.0-x64.exe` — NSIS installer (assisted install)
- `dist/RayNotes-Portable-2.0.0-x64.exe` — portable launcher
- `dist/win-unpacked/Ray Notes.exe` — unpacked application for a first smoke test
- `dist/RayNotes-2.0.0-SHA256.txt` — checksums after `npm run release:verify`

## Mandatory manual tests

1. Start `dist/win-unpacked/Ray Notes.exe` without using the Node development command. Confirm tray and dashboard work.
2. Test five notes, editing, Ctrl+S, closing immediately after typing, reopen and verify text persisted.
3. Verify clipboard paste sanitization, bullets, multiline checklists, seven colors, pin/unpin, Win+D and 8px native window corners.
4. Verify window edge/corner resizing and 280×320 minimum.
5. Quit via tray, then re-launch the unpacked app. Verify edits and positions persist.
6. Launch **portable** EXE separately after quitting the unpacked app; repeat basic note/tray/desktop tests.
7. **Only if intentionally testing installation**: launch NSIS Setup, inspect selected user scope/path, and verify the installed shortcut, executable, uninstall option and app-data preservation. Running Setup changes installed programs and shortcuts; it is not done by any validation script.
8. Keep a record of the **actual** `notes.json` path for each launch flavor before attempting any manual data migration.
9. Do not publish or distribute until a real Windows x64 run, required compatibility tests and signing decision are complete.

## Failure handling

- If any preflight or build check fails, preserve the existing `notes.json` and stop.
- Do not rename `productName` to resolve a file-naming issue; filenames are controlled by target-specific `artifactName`.
- `koffi` uses native binaries. A build that succeeds but fails to load native desktop APIs must be held for further diagnosis.
- Inspect Windows Event Viewer and app console errors for a crash. Never replace files in `%APPDATA%` as a build repair.
