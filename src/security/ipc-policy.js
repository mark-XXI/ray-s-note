'use strict';

function isTrustedFrame(event, webContents) {
  return Boolean(event && webContents && !webContents.isDestroyed?.() &&
    event.sender === webContents && event.senderFrame &&
    event.senderFrame === webContents.mainFrame);
}

function isAuthorizedNoteUpdate(id, data) {
  return Number.isSafeInteger(id) && id > 0 && data !== null &&
    typeof data === 'object' && !Array.isArray(data) &&
    data.id === id && typeof data.title === 'string' && data.title.trim().length <= 80 &&
    typeof data.content === 'string' && typeof data.color === 'string' &&
    Number.isSafeInteger(data.fontSize) && (data.dir === 'ltr' || data.dir === 'rtl') &&
    Object.keys(data).every(key => ['id', 'title', 'content', 'color', 'fontSize', 'dir'].includes(key));
}

module.exports = { isTrustedFrame, isAuthorizedNoteUpdate };
