# Ray's Note — Window lifecycle (Batch 04)

## Persisted visibility

- **Red Close**, **yellow Hide**, and **Dashboard Hide** all flush the latest text, persist `hidden: true`, then destroy that window. They keep the note record and allow recovery via Dashboard Show or tray Show All.
- **Dashboard Show** and tray Show All persist `hidden: false` before creating or revealing a note window.
- **Hide All** and a left-click on the tray icon (when any note is visible) now use the same durable hide behavior. Reopening the application does **not** automatically display intentionally hidden notes.
- **Tray Quit** preserves each note's *existing* visibility state, flushes pending edits, and does **not** mark all open notes as hidden. Visible notes are restored on the next launch.
- **Pin** is still a stored property only; real window pinning is Batch 08. The Show Desktop watcher is unchanged until Batch 09.

## Native close and failure behavior

- A native close request (such as Alt+F4) takes the same flush-and-persist path as the red Close button. If the renderer fails to confirm saving, or the on-disk state cannot be updated, the window stays open.
- Exit requests pass through `before-quit`: the app waits for queued lifecycle operations and asks each open editor to flush before allowing quit.
- There are no periodic file backups or repository commits in this patch. Git does not track notes.json in AppData.
- Operations for an individual note are serialized, preventing a quick Hide/Show/Delete sequence from leaving a mismatch.
- Dashboard On Desktop/Hidden counters report actual open window state rather than trusting only the persisted flag.

## Testing

Run `npm test`, `npm run test:syntax`, and `npm run start:test` from the project root. With the isolated profile, verify red Close, yellow Hide, Dashboard Hide/Show, tray Hide All/Show All, tray-click toggle, Alt+F4, and tray Quit/restart with immediate edits. Verify a hidden note stays hidden after app restart, while previously visible notes return. Confirm the dashboard counters reflect state. Do not deliberately corrupt real AppData notes.
