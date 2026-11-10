'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('raysNote', {
  onInit(callback) {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('init', (_event, note) => callback(note));
  },
  onPinChanged(callback) {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('note-pin-changed', (_event, pinned) => callback(pinned === true));
  },
  togglePin() { return ipcRenderer.invoke('toggle-note-pin'); },
  onFlushRequest(callback) {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('app-flush-request', (_event, requestId) => callback(requestId));
  },
  save(payload) {
    return ipcRenderer.invoke('note-update', {
      id: payload.id, content: payload.content, color: payload.color,
      fontSize: payload.fontSize, dir: payload.dir,
    });
  },
  flushResult(requestId, ok) {
    ipcRenderer.send('app-flush-result', { requestId, ok: ok === true });
  },
  close() { ipcRenderer.send('note-close'); },
  hide() { ipcRenderer.send('note-minimize'); },
  create() { ipcRenderer.send('note-new'); },
  dashboard() { ipcRenderer.send('open-dashboard'); },
});
