'use strict';

// These comparisons happen AFTER applyNotePatch() has validated the change.
// Returning a successful acknowledgement for an unchanged editor snapshot
// avoids rewriting notes.json just to refresh updatedAt.
const EDITOR_FIELDS = Object.freeze(['title', 'content', 'color', 'fontSize', 'dir']);

function editorFieldsChanged(previous, next) {
  return EDITOR_FIELDS.some((field) => previous[field] !== next[field]);
}

function patchFieldsChanged(previous, next, patch) {
  return Object.keys(patch).some((field) => previous[field] !== next[field]);
}

module.exports = { editorFieldsChanged, patchFieldsChanged };
