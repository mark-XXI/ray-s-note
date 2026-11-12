'use strict';

// Pure, Electron-independent note model. Never mutate input or discard unknown
// fields: older/newer app versions may have written metadata that we do not own.
const DEFAULT_COLOR = '#FFF9C4';
const DEFAULT_FONT_SIZE = 15;
const DEFAULT_DIRECTION = 'rtl';
const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const EDITABLE_FIELDS = new Set([
  'title', 'content', 'color', 'fontSize', 'dir', 'pinned', 'hidden',
  'x', 'y', 'w', 'h', 'updatedAt',
]);

class NoteValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NoteValidationError';
  }
}

function fail(message) {
  throw new NoteValidationError(message);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' &&
    !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function timestamp(value, field, defaultValue) {
  if (value === undefined) return defaultValue;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    fail(`${field} must be a valid date string`);
  }
  return value;
}

function validateInteger(value, field, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail(`${field} must be an integer between ${min} and ${max}`);
  }
  return value;
}


function validateTitle(value, noteId) {
  if (value === undefined && noteId === null) return '';
  if (typeof value !== 'string') fail(`Note ${noteId}: title must be text`);
  const normalized = value.trim();
  if (normalized.length > 80) fail(`Note ${noteId}: title must be at most 80 characters`);
  return normalized;
}

function normalizeStoredNote(note, now = () => new Date().toISOString()) {
  if (!isRecord(note)) fail('Every note must be a plain object');

  validateInteger(note.id, 'id', 1, Number.MAX_SAFE_INTEGER);
  const title = Object.hasOwn(note, 'title') ? validateTitle(note.title, note.id) : '';

  const content = note.content === undefined && !Object.hasOwn(note, 'content')
    ? '' : note.content;
  if (typeof content !== 'string') fail(`Note ${note.id}: content must be text`);

  const color = Object.hasOwn(note, 'color') ? note.color : DEFAULT_COLOR;
  if (typeof color !== 'string' || !COLOR_PATTERN.test(color)) {
    fail(`Note ${note.id}: color must be a six-digit hex color`);
  }

  const fontSize = Object.hasOwn(note, 'fontSize') ? note.fontSize : DEFAULT_FONT_SIZE;
  validateInteger(fontSize, `Note ${note.id}: fontSize`, 10, 30);

  const dir = Object.hasOwn(note, 'dir') ? note.dir : DEFAULT_DIRECTION;
  if (dir !== 'ltr' && dir !== 'rtl') {
    fail(`Note ${note.id}: dir must be ltr or rtl`);
  }

  const pinned = Object.hasOwn(note, 'pinned') ? note.pinned : false;
  const hidden = Object.hasOwn(note, 'hidden') ? note.hidden : false;
  if (typeof pinned !== 'boolean' || typeof hidden !== 'boolean') {
    fail(`Note ${note.id}: pinned and hidden must be booleans`);
  }

  const nowValue = now();
  const createdAt = timestamp(note.createdAt, `Note ${note.id}: createdAt`, nowValue);
  const updatedAt = timestamp(note.updatedAt, `Note ${note.id}: updatedAt`, createdAt);
  const normalized = { ...note,
    title, content, color, fontSize, dir, pinned, hidden, createdAt, updatedAt,
  };

  // Negative x/y are normal for displays positioned left/above the primary.
  for (const field of ['x', 'y']) {
    if (Object.hasOwn(note, field)) {
      normalized[field] = validateInteger(note[field], `Note ${note.id}: ${field}`, -1000000, 1000000);
    }
  }
  for (const field of ['w', 'h']) {
    if (Object.hasOwn(note, field)) {
      normalized[field] = validateInteger(note[field], `Note ${note.id}: ${field}`, 200, 16384);
    }
  }
  return normalized;
}

function normalizeStoredNotes(notes, now = () => new Date().toISOString()) {
  if (!Array.isArray(notes)) fail('Notes must be an array');
  const used = new Set();
  const normalized = notes.map((note, index) => {
    try {
      const value = normalizeStoredNote(note, now);
      if (used.has(value.id)) fail(`Duplicate note ID ${value.id}`);
      used.add(value.id);
      return value;
    } catch (error) {
      if (error instanceof NoteValidationError) {
        fail(`Notes item ${index}: ${error.message}`);
      }
      throw error;
    }
  });
  return normalized;
}

function allocateNoteId(notes, now = Date.now) {
  if (!Array.isArray(notes)) fail('Notes must be an array');
  const used = new Set(notes.map((note) => note.id));
  let candidate = now();
  validateInteger(candidate, 'New note ID', 1, Number.MAX_SAFE_INTEGER);
  while (used.has(candidate)) {
    if (candidate === Number.MAX_SAFE_INTEGER) fail('No note ID is available');
    candidate += 1;
  }
  return candidate;
}

function createDefaultNote(id, now = () => new Date().toISOString()) {
  const date = now();
  return normalizeStoredNote({
    id, title: '', content: '', color: DEFAULT_COLOR, fontSize: DEFAULT_FONT_SIZE,
    dir: DEFAULT_DIRECTION, pinned: false, hidden: false,
    createdAt: date, updatedAt: date,
  }, () => date);
}

function applyNotePatch(note, patch, now = () => new Date().toISOString()) {
  if (!isRecord(patch)) fail('Note update must be an object');
  for (const field of Object.keys(patch)) {
    if (!EDITABLE_FIELDS.has(field)) fail(`Cannot update note field: ${field}`);
  }
  // Only allow a defined set of changes. No editor/tray action may change ID
  // or creation time. Keep future/unknown stored note fields intact.
  return normalizeStoredNote({ ...note, ...patch }, now);
}

module.exports = {
  NoteValidationError, normalizeStoredNote, normalizeStoredNotes,
  allocateNoteId, createDefaultNote, applyNotePatch,
};
