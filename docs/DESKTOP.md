# Ray's Note — Desktop recovery (Batch 09)

## Why this is not native desktop embedding

Win+D is implemented by Explorer. Windows can minimize ordinary windows and
then promote the desktop surface. There is no documented Electron API to
parent interactive notes between Explorer's wallpaper and icon layers.
Modifying `Progman`/`WorkerW` with undocumented messages is fragile across
Explorer restarts, DPI configurations, virtual desktops, and Windows builds.
This batch does **not** use those undocumented calls or elevate notes into
full-screen applications.

## Behavior

- Previously: each note polled `isMinimized()` every 150 ms and restored as
  soon as it noticed a minimize.
- Now: a note schedules **one** restore attempt 350 ms after a native
  `minimize` event, guarded by the persisted visibility state and window
  lifetime. A native `restore`/`closed` event cancels recovery. This reduces
  background work and avoids regenerating explicitly hidden notes.
- Tray checkbox **Recover notes after Win+D** enables/disables the mechanism
  for the current application session. It defaults to enabled to preserve
  previous behavior. It is not saved to `notes.json`.
- Tray **Reveal Visible Notes** is a manual fallback if Windows keeps the
  desktop in front. It targets only previously visible notes, without
  changing their saved hidden/pinned state; it attempts to bring windows up
  without explicitly calling `.focus()`.
- Pinning and z-order are orthogonal: the existing `pinned` property still
  controls Electron `alwaysOnTop`. Automatic restore does not toggle pin.
- The title-bar Pin control is now a grey circular SVG like its neighbors;
  its glyph is revealed on hover/focus, and the pressed state gets a subtle
  grayscale ring (with `aria-pressed`).

## Windows manual validation

1. Open two unpinned notes, one pinned note, and one hidden note.
2. Press Win+D, verify notes remain accessible or use **Reveal Visible Notes**
   from the tray. A second Win+D should not create duplicate note windows.
3. Disable **Recover notes after Win+D**, press Win+D again: the app must not
   forcibly restore minimized note windows.
4. Re-enable recovery. Confirm the tray command still reveals only previously
   visible notes (hidden notes stay hidden in the Dashboard).
5. Open Notepad. Unpinned notes must not stick over Notepad; pinned notes
   must retain the always-on-top behavior.
6. Test Alt+Tab, fullscreen video, taskbar, dashboard, and desktop icons.
7. Relaunch with a pinned and unpinned note; verify both states and text.
8. Check pin glyph invisible until hover/focus and its pressed indication is
   subdued gray rather than colored emoji or gold.
9. Check existing bullets, multiline checklists, RTL/LTR, save, Hide/Show,
   and Quit still work.

Desktop-shell attachment and per-virtual-desktop placement remain unimplemented,
not guaranteed by this batch. Do not claim the note can survive Explorer
restarts as an actual wallpaper child window.
