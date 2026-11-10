# Batch 14 — Accessibility & Keyboard Workflows

Keyboard improvements are limited to renderer-level app commands; existing note editing and native Windows behavior remain unchanged.

## Note window
- `Ctrl+N`: create a note.
- `Ctrl+S`: flush the pending note save immediately.
- `Ctrl+Shift+D`: open the dashboard.
- `Ctrl+Shift+T`: show/hide formatting tools; opening by shortcut focuses its first button.
- `Escape`: dismiss visible tools and return focus to the editor.
- `Tab` / `Shift+Tab`: navigate title buttons, color buttons, and formatting controls. Press `Space` or `Enter` to activate.
- Standard editing shortcuts (`Ctrl+B`, `Ctrl+I`, `Ctrl+U`), task `Enter`, and `Shift+Enter` are not intercepted.
- Colors expose `aria-pressed`; the toolbar announces expanded state. The save label is a polite live status.

## Dashboard
- `Ctrl+F` or `/` outside text inputs: focus search.
- `Escape` in search: clear search, or move to New Note when already empty.
- `Ctrl+N`: create note.
- Filters expose `aria-pressed`. Note actions have descriptive accessible names, and card actions restore focus after list refresh where possible.
- Search result count is announced through a compact live region.

## Known limits and checks
- Electron's OS-level desktop integration is not modified. Screen reader behavior must be tested on actual Windows with Narrator/NVDA.
- Clipboard paste stays plain text by design. Avoid keyboard conflicts with system/global shortcuts.
- Native rounded corners remain a separate, Windows-only responsibility.
- These changes do not add backup files or migrate `notes.json`.
