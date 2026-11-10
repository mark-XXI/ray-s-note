# Batch 13 — Dashboard polish and native note corners

- Preserves the dashboard's existing dark/purple palette, IDs, note actions, stats, search and filtering.
- Gives stats their own compact cards, improves action hit targets, wrapping and keyboard focus. At narrow widths, the note actions occupy a second row instead of overflowing.
- The sticky note still uses an 8px CSS radius, but Windows x64 now also receives an **8 DIP native rounded GDI region** so that the real window boundary is curved against the wallpaper.
- During a native Windows manual resize, the region is removed before resizing begins and restored after it ends. A limited debounce handles programmatic size changes only; manual resizing is never re-clipped until Windows emits 'resized'. This is not Electron `setShape()` and does not enable transparency.
- Failures are nonfatal. The app stays a normal resizable rectangle and emits a warning. Set `RAYS_NOTE_DISABLE_NATIVE_CORNERS=1` before launching to disable native rounding temporarily for troubleshooting.
- Windows owns successful GDI region handles. If SetWindowRgn fails, the untransferred region is freed. All event listeners and pending callbacks are released when the window closes.

**Windows tests:** check round corners against a contrasting wallpaper; drag all four edges and corners repeatedly; ensure the radius is restored after resizing; change note colors; use Win+D and pin/unpin; exercise dashboard search/filter/manage actions; close/restart and verify note persistence. If native resize is impaired, do not commit, and use the documented environment variable to compare behavior.

Native window region APIs are Windows-specific and are not functionally verifiable from the Linux/Chromium CI environment. Do not claim Windows GUI pass based on Node tests.
