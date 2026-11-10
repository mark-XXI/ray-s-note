'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

class NoteStorageError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = 'NoteStorageError';
  }
}

class NoteStore {
  constructor(filePath, io = fs) {
    this.filePath = path.resolve(filePath);
    this.io = io;
  }

  load() {
    let raw;
    try {
      raw = this.io.readFileSync(this.filePath, 'utf8');
    } catch (error) {
      // A missing file means first launch. All other read failures are fatal.
      if (error.code === 'ENOENT') return [];
      throw new NoteStorageError(`Cannot read notes at ${this.filePath}`, error);
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new NoteStorageError(`Notes file is not valid JSON: ${this.filePath}`, error);
    }
    if (!Array.isArray(parsed) || parsed.some((note) => !note || typeof note !== 'object' || Array.isArray(note))) {
      throw new NoteStorageError(`Notes file has an invalid structure: ${this.filePath}`);
    }
    return parsed;
  }

  save(notes) {
    if (!Array.isArray(notes)) {
      throw new NoteStorageError('Refusing to save a non-array notes collection');
    }

    let serialized;
    try {
      serialized = JSON.stringify(notes, null, 2);
    } catch (error) {
      throw new NoteStorageError('Could not serialize notes', error);
    }

    const dir = path.dirname(this.filePath);
    const temporaryFile = path.join(
      dir,
      `.${path.basename(this.filePath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
    );
    let fd;
    try {
      this.io.mkdirSync(dir, { recursive: true });
      // Always write to a new file in the same directory. Never truncate notes.json.
      fd = this.io.openSync(temporaryFile, 'wx', 0o600);
      this.io.writeFileSync(fd, serialized, 'utf8');
      this.io.fsyncSync(fd);
      this.io.closeSync(fd);
      fd = undefined;
      this.io.renameSync(temporaryFile, this.filePath);
    } catch (error) {
      if (fd !== undefined) {
        try { this.io.closeSync(fd); } catch (_) { /* preserve original error */ }
      }
      try { this.io.unlinkSync(temporaryFile); } catch (_) { /* best effort temporary-file cleanup */ }
      throw new NoteStorageError(`Could not save notes at ${this.filePath}`, error);
    }
  }
}

module.exports = { NoteStore, NoteStorageError };
