# Ray's Note — Batch 12 visual polish

- A single note-shell clips header, color strip, editor, and footer at **16 CSS pixels**.
- Title bar and toolbar maintain existing actions and reveal-only icon semantics.
- Color swatches have an accessible selection outline; the palette is unchanged.
- The note editor remains flexibly sized and scrollable, including at 200x200.
- On Windows, a guarded **native window shape** removes the pixel corners without enabling Electron transparency (which can break resizing). The region is recalculated after window resizing, is not written to notes.json, and has a fail-open fallback if unsupported.
- On Windows 11, `roundedCorners: true` also requests the system-native rounded frameless style; the custom region is a separate guard for consistent 16px clipping.
- The shape is experimental and must be tested on the user's Windows version with the existing WorkerW desktop attachment and native pin/unpin behavior.

## GUI tests

1. Visual 16px corners visible on the desktop with no rectangular patch behind them.
2. Resize repeatedly from bottom/right/corners. Controls remain accessible.
3. Try all seven saved note colors. Each fills the rounded note surface.
4. Hide and show the toolbar/palette; type and scroll at minimum window size.
5. Verify grey pin hover state, pinned state, and colored titlebar controls.
6. Win+D wallpaper layering, pinning, moving, hide/show, and restart remain intact.
7. Bullet lists, multiline checklist, formatting, RTL and LTR, and autosave remain intact.

If Windows refuses `setShape`, the app should still render and save normally; report the warning rather than removing a Win32 safety check. Do not commit before GUI verification.
