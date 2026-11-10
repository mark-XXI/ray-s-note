# Ray's Note — Batch 12 repair: corners, resizing, minimum dimensions

This corrective patch follows the 16px visual redesign. The native `BrowserWindow.setShape()` region caused unreliable hit testing and could leave pixelated/rectangular artifacts as the note was resized.

- Remove custom native shape code and its delayed resize callbacks; Windows keeps the complete native resize frame.
- Keep `frame: false`, `resizable: true`, `thickFrame: true`, `transparent: false`, and request `roundedCorners: true` using Electron's supported window option. Windows 11 22000+ may render system-native rounding; on older Windows it is not available, so we deliberately do not fake a cutout that harms resizing.
- Reduce note-shell CSS radius to **8px**. Make the opaque `body` background match the colored shell, avoiding colored-square/black-corner artifacts during repaints.
- Increase minimum usable note size from **200×200 to 280×320 device-independent pixels**. Existing stored geometry remains unchanged until the user deliberately moves/resizes; `NoteGeometry` visually honors the minimum.
- Do not change the seven-color palette, pin style, text editor, bullets, tasks, dashboard, IPC, Win+D desktop ownership, or saved notes schema.

## Manual Windows regression gate

1. Resize from all four edges and corners; ensure no stuttering or lost hit targets.
2. Move between the smallest permitted window (280×320) and a larger size; toolbar/editor must remain usable and scroll.
3. Test yellow, green, blue, pink, purple, orange and white; no mismatched corner patches.
4. Verify subtle corners with note on wallpaper (Win+D), and pinned above a normal application.
5. Quit/relaunch; note content, colors, visibility, pin state and dimensions survive.
6. Verify checklists, Shift+Enter, bullets, text selection, dashboard, tray operations.

**Windows caveat:** The OS-native `roundedCorners` option is supported on Windows 11, not Windows 10. Windows 10 may show a rectangular outer window; this is preferred to breaking resizing or exposing mismatched background colors.
