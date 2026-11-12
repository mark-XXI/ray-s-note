# Ray's Note — Windows Build Guide

**Release configuration (Batch 16): Windows x64, Electron 28 / electron-builder 24.**

## Requirements
- Windows x64, Node.js 22.x and npm 10.x
- Internet access for initial dependency and electron-builder binary downloads
- Run commands from the repository root

## Isolated development smoke test

```powershell
npm ci
npm run start:test
```

`start:test` stores temporary test notes under `.rays-note-test-data`; it does not use the normal profile.

## Build and verify both Windows distributions

```powershell
npm ci
npm run release:preflight
npm run build
npm run release:verify
```

Expected files in `dist/`:
- `RayNotes-Setup-2.0.0-x64.exe` — assisted Windows installer
- `RayNotes-Portable-2.0.0-x64.exe` — portable Windows executable
- `win-unpacked/Ray Notes.exe` — unpacked launch test
- `RayNotes-2.0.0-SHA256.txt` — generated artifact hashes

The app icon `note-icon.ico` is included as both the Windows executable icon and the runtime tray icon. Native `koffi` files are explicitly unpacked from ASAR.

## Existing notes and first packaged launch

Notes are stored in Electron's `app.getPath('userData')/notes.json`. Depending on which development or packaged build was used previously, its app name and default profile directory may differ. **Do not assume they all share one folder.** This build does not migrate, overwrite, or delete old profiles. NSIS is configured to retain app data when uninstalled.

Building never launches the installer or modifies the user's saved notes. Launching/installing an EXE is a separate intentional Windows manual test. Windows may warn about unsigned builds.

See [docs/RELEASE.md](docs/RELEASE.md) for safety checks and the complete Windows GUI acceptance list.
