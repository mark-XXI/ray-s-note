# Batch 07 — Bullet lists and multiline checklist items

## Checklist keyboard behavior

- `Enter` creates the next task (unchanged).
- `Enter` on an empty task exits the checklist (unchanged).
- `Backspace` on an empty task removes the row (unchanged).
- `Shift+Enter` creates a newline within the **same** task, preserving one checkbox for the entire multiline description.
- Newlines are persisted as text inside the allowed `.task-text` element and rendered with `white-space: pre-wrap`.
- Existing checked/unchecked state, direction, and sanitization remain unchanged.

## Bullet behavior

- Clicking Bullet with an empty editor creates an unordered list with a usable caret.
- Clicking Bullet inside a paragraph converts that block without losing its text or inline formatting. Selecting multiple paragraphs converts each into a bullet and leaves unselected paragraphs intact.
- Clicking Bullet inside an existing list item toggles the item back into normal text; other items remain bullets.
- Clicking Bullet while editing a checklist item inserts a separate bullet list after the task; the task remains untouched.
- Use Enter to continue a bullet list; Enter on an empty bullet exits it. Chrome/Electron's native list editing handles the Enter behavior after our explicit list insertion.
- Lists survive note sanitization, save, and reopen.

## Acceptance

Run `npm test`, `npm run test:syntax`, and `npm run start:test`. Exercise bullets in an empty note, after text, on selected text, inside RTL/English content, multiple bullets, toggling off, and persistence. Exercise multiline tasks with Shift+Enter, including multiple lines and checked-state persistence. Confirm all Batch 06 checklist interactions still work.
