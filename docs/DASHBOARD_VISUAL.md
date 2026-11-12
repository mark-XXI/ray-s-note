# Batch 13 — Dashboard polish and native note corners

- Preserves the dashboard's existing dark/purple palette, IDs, note actions, stats, search and filtering.
- Gives stats their own compact cards, improves action hit targets, wrapping and keyboard focus. At narrow widths, the note actions occupy a second row instead of overflowing.
- The sticky note still uses an 8px CSS radius, but Windows x64 now also receives an **8 DIP native rounded GDI region** so that the real window boundary is curved against the wallpaper.
- During a native Windows manual resize, the region is removed before resizing begins and restored after it ends. A limited debounce handles programmatic size changes only; manual resizing is never re-clipped until Windows emits 'resized'. This is not Electron `setShape()` and does not enable transparency.
- Failures are nonfatal. The app stays a normal resizable rectangle and emits a warning. Set `RAYS_NOTE_DISABLE_NATIVE_CORNERS=1` before launching to disable native rounding temporarily for troubleshooting.
- Windows owns successful GDI region handles. If SetWindowRgn fails, the untransferred region is freed. All event listeners and pending callbacks are released when the window closes.

**Windows tests:** check round corners against a contrasting wallpaper; drag all four edges and corners repeatedly; ensure the radius is restored after resizing; change note colors; use Win+D and pin/unpin; exercise dashboard search/filter/manage actions; close/restart and verify note persistence. If native resize is impaired, do not commit, and use the documented environment variable to compare behavior.

Native window region APIs are Windows-specific and are not functionally verifiable from the Linux/Chromium CI environment. Do not claim Windows GUI pass based on Node tests.

## Pre-release dashboard redesign — theme support

- The dashboard uses a simplified header, a single compact statistics strip, smaller note cards and clearly separated controls. Existing IDs, note management operations, search, filters, announcements and focus recovery remain intact.
- The first restyle offered a three-option appearance selector. **This selector has now been replaced by the one-click sun/moon button described below.** The old `rays-note-dashboard-theme-v1` preference is ignored.
- Appearance changes are dashboard-only: no note data, native desktop integration, pin state, IPC route or persisted note schema changes.
- The original Batch 16 release configuration is retained as applied and uncommitted; this UI revision must be tested before packaging or final commit.
- Manual Windows GUI checks: first-launch computer theme, sun/moon toggle, Shift+click system reset, system-theme switching, reopening after a manual choice, live stats and card actions, keyboard search/filter/focus, long previews, narrow window, Win+D/pinning, rounded note corners and autosave.

## One-click appearance refinement (Batch 16UI.1)

- Sun/moon control switches between light and dark with one click. It is a real keyboard-accessible button with a state-aware label.
- On first use, Dashboard follows Windows' system appearance; the older three-option selector preference is intentionally ignored.
- An explicit choice persists for subsequent Dashboard launches where local storage is supported.
- Shift+click the sun/moon button to reset the preference and follow Windows again. While following the system, the icon updates if Windows changes appearance.
- The light palette adds warm lilac and peach header tones, a pale lavender canvas, tinted summary and footer surfaces, and subtle depth. Dark mode stays slate-based.
- Note colors, storage schema, dashboard actions, and the six pending release files remain unchanged.
