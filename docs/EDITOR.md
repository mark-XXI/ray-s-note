# Batch 06 — Rich Text + Checklist Stabilization

Task checklist editing was inconsistent because rows mixed nested contenteditable regions, inserted HTML at the caret, and did not synchronize checkbox property state to the HTML attribute.

## New behavior

- A checklist row is a protected block; only the task text itself is editable.
- The checkbox state is reflected in `checked` before JSON persistence and on restore.
- A task can be inserted next to the active editing block; typing begins in the new task.
- Enter creates another task. Enter again on an empty task exits the checklist to a normal line.
- Backspace on an empty task removes it; when another task precedes it, the caret returns to its text.
- Task text works with RTL and LTR note direction and supports checked strikethrough.
- Toolbar mouse-down no longer steals the editor selection. Bullets now use an actual unordered list.
- Existing notes retain their original content format; no data migration or forced overwrite occurs.

## Acceptance tests

In the isolated test profile run `npm test`, `npm run test:syntax`, and `npm run start:test`. Test inserting 3+ tasks, Enter/Backspace, selecting and checking, restarting with checked/unchecked states, RTL and LTR, editor formatting, closing immediately after changing a checkbox, and malicious HTML paste.

## Remaining editor work

Chromium's native rich-text undo history may not cover all manually inserted structured task rows. Full undo/redo semantics for structural task changes and richer paste are separate follow-up improvements.
