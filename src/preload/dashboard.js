'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('raysDashboard', {
  onNotes(callback) {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('notes-list', (_event, notes) => callback(notes));
  },
  requestNotes() { ipcRenderer.send('get-notes'); },
  create() { ipcRenderer.send('new-note-from-dash'); },
  show(id) { ipcRenderer.send('show-note', id); },
  hide(id) { ipcRenderer.send('hide-note', id); },
  pin(id) { ipcRenderer.send('pin-note', id); },
  delete(id) { ipcRenderer.send('delete-note', id); },
});
