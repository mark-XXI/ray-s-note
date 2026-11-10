# Ray's Note — Batch 05 security changes

## Renderer isolation

Both windows use sandboxed renderers (`nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`). The preload files expose a *small, window-specific* API through `contextBridge`. They do not expose `ipcRenderer`, its event objects, Node.js, or arbitrary channels. Electron 28.3.3 remains installed; upgrading Electron is a separate release decision.

## IPC authority

Main-process handlers verify that an event came from the expected BrowserWindow's *main frame*. Note update requests must match that window's note ID. Dashboard actions require the dashboard window; note updates cannot be issued by the dashboard.

## HTML and navigation

Both pages use a meta Content Security Policy, static external scripts, and `addEventListener` handlers rather than HTML event attributes. Unexpected page navigation, popup windows, and webviews are denied. Permission requests are denied for this local-only app. The dashboard uses `textContent` for note previews rather than interpolating note HTML.

The editor sanitizes note HTML on display and before persistence using an explicit tag/style allowlist. It strips scripting elements, event-handler attributes, URLs, and embeds. Paste is plain text in this security batch. Existing note files are **not rewritten on load**; unsupported HTML formatting may be dropped when the note is next edited and saved. The checklist DOM representation (checkbox/task-row/task-text) is preserved, but checklist state persistence still belongs to Batch 07.

## Important limitations and follow-up

* The app still uses local `file://` pages; a custom secure protocol is a possible later enhancement.
* Clipboard rich-text paste is intentionally disabled here pending an explicit safe-formatting policy in Batch 06.
* This patch does not upgrade Electron, change the note model/storage file, or implement desktop pinning.
* Static/Node tests cannot prove all Electron rendering and CSP behavior on Windows. Run the Windows GUI regression scenarios before committing.
