# Ray's Note — Baseline Testing (Batch 01)

This batch adds testing infrastructure and a safe development profile. It deliberately does **not** fix existing product bugs or change the persisted note format.

## Verified developer environment (initial audit, 2026-11-10)

- Branch: `fix/rays-note-full-stabilization`
- Baseline commit: `c06db69` (`Font size fix`)
- Windows PowerShell: 5.1
- Node.js: 22.14.0
- npm: 10.9.2
- Electron installed: 28.3.3
- electron-builder installed: 24.13.3
- koffi installed: 2.16.3

These are environment observations, not a locked support matrix.

## Commands

Run from the repository root:

```powershell
npm test
npm run test:syntax
npm run start:test
```

- `npm test` uses Node's built-in test runner for **structural baseline tests**, not graphical or integration validation.
- `npm run test:syntax` parses the JavaScript entry points without starting Electron.
- `npm run start:test` starts Electron with a separate note-data directory: `.rays-note-test-data/` (ignored by Git). Only this explicit command enables the testing profile.
- `npm start` still uses the normal Electron userData directory (often `%APPDATA%\rays-note`). Do **not** use `npm start` for destructive testing against personal notes.
- Git can roll back tracked source changes, but **not** untracked user data stored in AppData. No backup steps are included in this workflow.

Quit the tray process before restarting for accurate restart tests. Use the same command for both runs; don't mix normal and test profiles.

## Manual Windows baseline verification

Use test-only notes in the isolated profile. Mark each case Pass/Fail/Blocked and attach screenshots/logs when there is a failure. This checklist describes desired behavior; failures are expected until later batches.

| ID | Scenario | Procedure | Expected result | Result |
| --- | --- | --- | --- | --- |
| WIN-01 | First launch | Run `npm run start:test` with no test data | A sticky note opens and a tray icon appears | Not run |
| WIN-02 | Edit / persistence | Type a unique string, wait 1s, quit via tray, relaunch | Text is still present | Not run |
| WIN-03 | Immediate quit | Type and quit immediately, then relaunch | Most recent edit is not lost | Not run |
| WIN-04 | Create notes | Create 3 notes from note controls / dashboard | Distinct, independent note windows | Not run |
| WIN-05 | Hide / restore | Hide note via yellow button, inspect dashboard, relaunch | State is consistent in UI and next launch | Not run |
| WIN-06 | Dashboard actions | Search, filter, show, hide, pin and unpin | UI and window state agree | Not run |
| WIN-07 | Pin behavior | Pin note and focus another application | Expected always-on-top behavior, when enabled | Not run |
| WIN-08 | Show Desktop | With notes open, press Win+D and open another app | No unexpected focus stealing or flickering | Not run |
| WIN-09 | Editing controls | Test bold, italic, underline, alignment, font size | Formatting stays correct after relaunch | Not run |
| WIN-10 | RTL/LTR | Enter Arabic and English lines with punctuation | Direction and cursor remain appropriate after relaunch | Not run |
| WIN-11 | Checklist | Insert, check, uncheck and relaunch | Checkbox states and strike-through persist | Not run |
| WIN-12 | Moving / resizing | Move and resize a note, quit/reopen | Note position and size are restored | Not run |
| WIN-13 | Multi-monitor | Move note to secondary display, disconnect it | Note remains reachable on an active display | Not run |
| WIN-14 | Delete | Delete a test note from dashboard | Note does not return on relaunch | Not run |
| WIN-15 | Data isolation | Inspect `.rays-note-test-data/notes.json` | Test notes are stored here, not in default profile | Not run |

## Reporting failures

Provide the scenario ID, exact steps, expected vs. actual behavior, application/PowerShell errors, and a screenshot or short screen recording if visual.

## Batch 01 completion gate

- [ ] Working tree was clean before applying patch
- [ ] `npm test` passes
- [ ] `npm run test:syntax` passes
- [ ] `npm run start:test` opens the application on Windows
- [ ] Test profile writes `.rays-note-test-data/notes.json` after a test note edit
- [ ] Normal source files remain unchanged outside Batch 01's reviewed diff
- [ ] `git diff --check` passes
- [ ] Manual baseline matrix results recorded (known defects can be marked Fail)
- [ ] User manually commits `chore: establish baseline and testing infrastructure`

Do not mark desktop behavior as verified based solely on the automated tests. The GUI baseline requires manual execution on Windows.
