# Ray's Note — note model and compatibility (Batch 03)

The on-disk format is still a **JSON array** at the existing user data path. This batch does not change the file name, add a database, or write the file merely because the app launched.

## Model fields

- `id`: positive safe integer, unique for each note. Existing numeric IDs stay intact.
- `content`: HTML string, stored unchanged. Sanitization is planned separately in the security/editor batches.
- `color`: six-digit `#RRGGBB` or `#rrggbb` value; defaults to `#FFF9C4` if missing.
- `fontSize`: integer from 10 to 30; defaults to 15 if missing.
- `dir`: `ltr` or `rtl`; defaults to `rtl` if missing.
- `pinned`, `hidden`: booleans, default false if missing.
- `createdAt`, `updatedAt`: parseable date strings; when missing, default to the current time / creation timestamp.
- `x`, `y`: optional signed integer desktop coordinates, including negatives for secondary monitors.
- `w`, `h`: optional integer window dimensions, at least 200 pixels.

Unknown fields are intentionally preserved so later or earlier versions do not silently erase additional metadata.

## Startup / upgrade behavior

`NoteStore.load()` still reads and parses JSON without mutation. Immediately afterward, the main process validates and fills optional fields **in memory**. Nothing is written merely by loading. The next successful user-requested save writes the normalized array through the atomic storage layer from Batch 02.

Explicitly malformed values, unsafe IDs, duplicate IDs, or invalid collection shapes cause startup to stop without rewriting `notes.json`. This protects the original data; it is not an automatic repair utility. A separate recovery workflow may be built if real-world data proves to require it.

New notes receive a unique numeric ID even when generated in the same millisecond. Existing IDs and unknown metadata are preserved. Note updates accept only known mutable fields.

## Boundaries

This batch does **not** change Electron security settings, sanitize pasted HTML, fix window positioning across monitors, or alter the current pin/hide UI behavior. Those tasks are assigned to later batches.

## Verification

Run `npm test`, `npm run test:syntax`, and `npm run start:test`. Test creation of multiple notes, editing, RTL/LTR, color and font size changes, quitting and reopening, and visibility of previous notes. Do not test malformed JSON using the normal AppData profile; the automated suite uses disposable OS temp folders.
