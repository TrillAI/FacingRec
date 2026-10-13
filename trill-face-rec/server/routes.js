// REST API for Trill Face Rec.
'use strict';

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { db, FACE_DIR, DESCRIPTOR_LEN, descriptorToBlob, blobToArray } = require('./db');

const router = express.Router();
const API_KEY = process.env.TRILL_API_KEY || '';
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const PALETTE = ['#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#eab308', '#22c55e', '#06b6d4'];

// ---- auth (optional shared key) -------------------------------------------
function requireKey(req, res, next) {
  if (!API_KEY) return next();
  const given = req.get('x-api-key') || '';
  const a = Buffer.from(given);
  const b = Buffer.from(API_KEY);
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
  return res.status(401).json({ error: 'Invalid or missing API key' });
}
// Public liveness check (reports whether a key is required).
router.get('/health', (req, res) => {
  res.json({ ok: true, name: 'Trill Face Rec', time: Date.now(), authRequired: !!API_KEY });
});

router.use(requireKey);

// ---- helpers ---------------------------------------------------------------
const now = () => Date.now();
const bad = (res, msg) => res.status(400).json({ error: msg });

function validName(name) {
  return typeof name === 'string' && name.trim().length >= 1 && name.trim().length <= 80;
}

function validDescriptor(d) {
  return Array.isArray(d) && d.length === DESCRIPTOR_LEN &&
    d.every((n) => typeof n === 'number' && Number.isFinite(n));
}

function personRow(id) {
  return db.prepare('SELECT * FROM people WHERE id = ?').get(id);
}

function serializePerson(p) {
  return {
    id: p.id,
    name: p.name,
    notes: p.notes,
    color: p.color,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    faceCount: p.face_count ?? undefined,
  };
}

function pickColor() {
  const counts = db.prepare('SELECT color, COUNT(*) c FROM people GROUP BY color').all();
  const used = new Map(counts.map((r) => [r.color.toLowerCase(), r.c]));
  let best = PALETTE[0];
  let bestCount = Infinity;
  for (const c of PALETTE) {
    const n = used.get(c) || 0;
    if (n < bestCount) { best = c; bestCount = n; }
  }
  return best;
}

// Decode a data: URL image; returns { buf, ext } or null.
function decodeImage(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const m = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) return null;
  return { buf, ext: m[1] === 'png' ? 'png' : m[1] === 'webp' ? 'webp' : 'jpg' };
}

function saveThumb(decoded) {
  const name = `${crypto.randomUUID()}.${decoded.ext}`;
  fs.writeFileSync(path.join(FACE_DIR, name), decoded.buf);
  return name;
}

function removeThumb(name) {
  if (!name) return;
  const safe = path.basename(name);
  fs.promises.unlink(path.join(FACE_DIR, safe)).catch(() => {});
}

// ---- health / stats --------------------------------------------------------

router.get('/stats', (req, res) => {
  const people = db.prepare('SELECT COUNT(*) n FROM people').get().n;
  const faces = db.prepare('SELECT COUNT(*) n FROM faces').get().n;
  const events = db.prepare('SELECT COUNT(*) n FROM events').get().n;
  const today = db.prepare('SELECT COUNT(*) n FROM events WHERE created_at >= ?')
    .get(new Date().setHours(0, 0, 0, 0)).n;
  res.json({ people, faces, events, eventsToday: today });
});

// ---- people ----------------------------------------------------------------
const listPeople = db.prepare(`
  SELECT p.*, (SELECT COUNT(*) FROM faces f WHERE f.person_id = p.id) AS face_count
  FROM people p ORDER BY p.name COLLATE NOCASE
`);

router.get('/people', (req, res) => {
  res.json(listPeople.all().map(serializePerson));
});

router.post('/people', (req, res) => {
  const { name, notes = '', color } = req.body || {};
  if (!validName(name)) return bad(res, 'Name must be 1-80 characters');
  if (color && !HEX_COLOR.test(color)) return bad(res, 'Color must be #rrggbb');
  const clean = name.trim();
  if (db.prepare('SELECT 1 FROM people WHERE name = ?').get(clean)) {
    return res.status(409).json({ error: 'A person with that name already exists' });
  }
  const t = now();
  const info = db.prepare(
    'INSERT INTO people (name, notes, color, created_at, updated_at) VALUES (?,?,?,?,?)'
  ).run(clean, String(notes).slice(0, 2000), color || pickColor(), t, t);
  res.status(201).json(serializePerson(personRow(info.lastInsertRowid)));
});

router.get('/people/:id', (req, res) => {
  const p = personRow(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const faceCount = db.prepare('SELECT COUNT(*) n FROM faces WHERE person_id = ?').get(p.id).n;
  res.json(serializePerson({ ...p, face_count: faceCount }));
});

router.patch('/people/:id', (req, res) => {
  const p = personRow(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const { name, notes, color } = req.body || {};
  const next = {
    name: p.name,
    notes: p.notes,
    color: p.color,
  };
  if (name !== undefined) {
    if (!validName(name)) return bad(res, 'Name must be 1-80 characters');
    const clean = name.trim();
    const clash = db.prepare('SELECT id FROM people WHERE name = ? AND id != ?').get(clean, p.id);
    if (clash) return res.status(409).json({ error: 'A person with that name already exists' });
    next.name = clean;
  }
  if (notes !== undefined) next.notes = String(notes).slice(0, 2000);
  if (color !== undefined) {
    if (!HEX_COLOR.test(color)) return bad(res, 'Color must be #rrggbb');
    next.color = color;
  }
  db.prepare('UPDATE people SET name=?, notes=?, color=?, updated_at=? WHERE id=?')
    .run(next.name, next.notes, next.color, now(), p.id);
  // keep historical event labels in sync with the new name
  db.prepare('UPDATE events SET label = ? WHERE person_id = ?').run(next.name, p.id);
  res.json(serializePerson(personRow(p.id)));
});

router.delete('/people/:id', (req, res) => {
  const p = personRow(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const files = db.prepare('SELECT thumb_file FROM faces WHERE person_id = ?').all(p.id);
  db.prepare('DELETE FROM people WHERE id = ?').run(p.id); // cascades to faces
  files.forEach((f) => removeThumb(f.thumb_file));
  res.json({ ok: true, deletedFaces: files.length });
});

// ---- faces (enrolled samples) ---------------------------------------------
router.get('/people/:id/faces', (req, res) => {
  const p = personRow(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const rows = db.prepare('SELECT id, thumb_file, source, created_at FROM faces WHERE person_id = ? ORDER BY created_at DESC')
    .all(p.id);
  res.json(rows.map((r) => ({
    id: r.id,
    source: r.source,
    createdAt: r.created_at,
    thumbUrl: r.thumb_file ? `faces/${r.id}/thumb` : null,
  })));
});

router.post('/people/:id/faces', (req, res) => {
  const p = personRow(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const { descriptor, image, source = 'camera' } = req.body || {};
  if (!validDescriptor(descriptor)) return bad(res, `descriptor must be ${DESCRIPTOR_LEN} finite numbers`);
  let thumb = null;
  if (image) {
    const decoded = decodeImage(image);
    if (!decoded) return bad(res, 'image must be a jpeg/png/webp data URL under 1.5MB');
    thumb = saveThumb(decoded);
  }
  const info = db.prepare(
    'INSERT INTO faces (person_id, descriptor, thumb_file, source, created_at) VALUES (?,?,?,?,?)'
  ).run(p.id, descriptorToBlob(descriptor), thumb, String(source).slice(0, 32), now());
  db.prepare('UPDATE people SET updated_at = ? WHERE id = ?').run(now(), p.id);
  res.status(201).json({ id: info.lastInsertRowid, personId: p.id, thumbUrl: thumb ? `faces/${info.lastInsertRowid}/thumb` : null });
});

router.get('/faces/:id/thumb', (req, res) => {
  const row = db.prepare('SELECT thumb_file FROM faces WHERE id = ?').get(req.params.id);
  if (!row || !row.thumb_file) return res.status(404).end();
  const file = path.join(FACE_DIR, path.basename(row.thumb_file));
  if (!fs.existsSync(file)) return res.status(404).end();
  res.set('Cache-Control', 'private, max-age=86400');
  res.sendFile(file);
});

router.delete('/faces/:id', (req, res) => {
  const row = db.prepare('SELECT thumb_file FROM faces WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM faces WHERE id = ?').run(req.params.id);
  removeThumb(row.thumb_file);
  res.json({ ok: true });
});

// ---- gallery (what devices download to recognize offline) -----------------
router.get('/gallery', (req, res) => {
  const people = listPeople.all();
  const rows = db.prepare('SELECT id, person_id, descriptor FROM faces ORDER BY id').all();
  const byPerson = new Map();
  for (const r of rows) {
    if (!byPerson.has(r.person_id)) byPerson.set(r.person_id, []);
    byPerson.get(r.person_id).push(blobToArray(r.descriptor));
  }
  res.json({
    version: now(),
    people: people.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      descriptors: byPerson.get(p.id) || [],
    })),
  });
});

// ---- recognition events ----------------------------------------------------
router.post('/events', (req, res) => {
  const { personId = null, label, status, distance = null, device = '' } = req.body || {};
  if (!['match', 'possible', 'unknown'].includes(status)) return bad(res, 'status invalid');
  if (typeof label !== 'string' || !label.trim()) return bad(res, 'label required');
  // a device may log an identity for a person deleted moments ago; keep the event, drop the link
  const exists = personId != null && db.prepare('SELECT 1 FROM people WHERE id = ?').get(personId);
  const dist = typeof distance === 'number' && Number.isFinite(distance) ? distance : null;
  const info = db.prepare(
    'INSERT INTO events (person_id, label, status, distance, device, created_at) VALUES (?,?,?,?,?,?)'
  ).run(exists ? personId : null, label.slice(0, 80), status, dist, String(device).slice(0, 80), now());
  res.status(201).json({ id: info.lastInsertRowid });
});

router.get('/events', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const rows = db.prepare('SELECT * FROM events ORDER BY created_at DESC LIMIT ?').all(limit);
  res.json(rows.map((r) => ({
    id: r.id, personId: r.person_id, label: r.label, status: r.status,
    distance: r.distance, device: r.device, createdAt: r.created_at,
  })));
});

router.delete('/events', (req, res) => {
  const info = db.prepare('DELETE FROM events').run();
  res.json({ ok: true, deleted: info.changes });
});

// 404 for unknown API routes (keeps SPA fallback from swallowing them)
router.use((req, res) => res.status(404).json({ error: 'Unknown API route' }));

module.exports = router;
