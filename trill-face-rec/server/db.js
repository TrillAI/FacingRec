// SQLite persistence layer for Trill Face Rec.
// Uses better-sqlite3 (synchronous, very fast for a single-node app).
'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FACE_DIR = path.join(DATA_DIR, 'faces');
fs.mkdirSync(FACE_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'trill.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS people (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    notes       TEXT    NOT NULL DEFAULT '',
    color       TEXT    NOT NULL DEFAULT '#3b82f6',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS faces (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id   INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    descriptor  BLOB    NOT NULL,           -- 128 x float32, little endian
    thumb_file  TEXT,                       -- filename inside data/faces
    source      TEXT    NOT NULL DEFAULT 'camera',
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_faces_person ON faces(person_id);

  CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id   INTEGER REFERENCES people(id) ON DELETE SET NULL,
    label       TEXT    NOT NULL,           -- person name or 'Unknown'
    status      TEXT    NOT NULL,           -- match | possible | unknown
    distance    REAL,
    device      TEXT    NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_events_time ON events(created_at);
`);

const DESCRIPTOR_LEN = 128;

function descriptorToBlob(arr) {
  const f32 = new Float32Array(arr);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

function blobToArray(buf) {
  // copy into a fresh aligned buffer
  const copy = Buffer.from(buf);
  return Array.from(new Float32Array(copy.buffer, copy.byteOffset, DESCRIPTOR_LEN));
}

module.exports = { db, FACE_DIR, DATA_DIR, DESCRIPTOR_LEN, descriptorToBlob, blobToArray };
