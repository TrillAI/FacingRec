import express, { Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import compression from 'compression';
import Database from 'better-sqlite3';
import { createServer as createViteServer } from 'vite';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// 1. SQLite Persistence Layer (Trill Face Rec Schema & Helpers)
// ============================================================================
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
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

  CREATE TABLE IF NOT EXISTS intruders (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    thumb_file  TEXT,
    descriptor  BLOB,
    label       TEXT    NOT NULL DEFAULT 'Unknown Subject',
    note        TEXT    NOT NULL DEFAULT '',
    distance    REAL,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_intruders_time ON intruders(created_at);
`);

const DESCRIPTOR_LEN = 128;

function descriptorToBlob(arr: number[]): Buffer {
  const f32 = new Float32Array(arr);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

function blobToArray(buf: Buffer): number[] {
  const copy = Buffer.from(buf);
  return Array.from(new Float32Array(copy.buffer, copy.byteOffset, DESCRIPTOR_LEN));
}

// ============================================================================
// 2. Firebase JWT Token Verification + Optional Trill API Key Auth
// ============================================================================
interface DecodedFirebaseJwt {
  uid: string;
  email?: string;
  name?: string;
  picture?: string;
  exp: number;
  iat: number;
  aud: string;
  iss: string;
}

interface FirebasePublicJwk extends crypto.JsonWebKey {
  kid?: string;
  alg?: string;
  use?: string;
}

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'firebase-applet-config.json'), 'utf8')).projectId || '';
  } catch {
    return '';
  }
})();
const FIREBASE_SIGNING_CERTS_URL =
  process.env.FIREBASE_SIGNING_CERTS_URL ||
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
type FirebasePublicKey = ReturnType<typeof crypto.createPublicKey>;
let firebasePublicKeyCache: { keys: Map<string, FirebasePublicKey>; expiresAt: number } | null = null;
let firebasePublicKeyRequest: Promise<Map<string, FirebasePublicKey>> | null = null;

async function getFirebasePublicKeys(): Promise<Map<string, FirebasePublicKey>> {
  if (firebasePublicKeyCache && firebasePublicKeyCache.expiresAt > Date.now()) {
    return firebasePublicKeyCache.keys;
  }
  if (firebasePublicKeyRequest) return firebasePublicKeyRequest;

  firebasePublicKeyRequest = (async () => {
    const response = await fetch(FIREBASE_SIGNING_CERTS_URL, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Firebase signing keys returned HTTP ${response.status}`);

    const jwks = (await response.json()) as { keys?: FirebasePublicJwk[] };
    if (!Array.isArray(jwks.keys)) throw new Error('Firebase signing key response is invalid');

    const keys = new Map<string, FirebasePublicKey>();
    for (const jwk of jwks.keys) {
      if (
        typeof jwk.kid !== 'string' ||
        jwk.kty !== 'RSA' ||
        typeof jwk.n !== 'string' ||
        typeof jwk.e !== 'string' ||
        (jwk.alg && jwk.alg !== 'RS256') ||
        (jwk.use && jwk.use !== 'sig')
      ) {
        continue;
      }

      try {
        const publicJwk: crypto.JsonWebKey = { kty: jwk.kty, n: jwk.n, e: jwk.e };
        keys.set(jwk.kid, crypto.createPublicKey({ key: publicJwk, format: 'jwk' }));
      } catch {
        // Skip malformed or unsupported keys without rejecting a valid key set.
      }
    }
    if (keys.size === 0) throw new Error('Firebase signing key response contains no usable keys');

    const maxAge = Number(response.headers.get('cache-control')?.match(/max-age=(\d+)/i)?.[1] || 3600);
    firebasePublicKeyCache = {
      keys,
      expiresAt: Date.now() + Math.max(1, maxAge) * 1000,
    };
    return keys;
  })();

  try {
    return await firebasePublicKeyRequest;
  } finally {
    firebasePublicKeyRequest = null;
  }
}

async function verifyAndDecodeFirebaseJwt(authHeader?: string): Promise<DecodedFirebaseJwt | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ') || !FIREBASE_PROJECT_ID) return null;
  const token = authHeader.slice(7).trim();
  if (token.length > 8192) return null;

  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return null;

  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;
    if (typeof payload.sub !== 'string' || payload.sub.length < 1 || payload.sub.length > 128) return null;
    if (!Number.isSafeInteger(payload.exp) || !Number.isSafeInteger(payload.iat)) return null;
    if (payload.aud !== FIREBASE_PROJECT_ID) return null;

    const issuer = `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;
    if (payload.iss !== issuer) return null;

    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.exp <= nowSec - 60 || payload.iat > nowSec + 60 || payload.iat >= payload.exp) return null;

    const publicKey = (await getFirebasePublicKeys()).get(header.kid);
    if (!publicKey) return null;
    const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`);
    const signature = Buffer.from(parts[2], 'base64url');
    if (!crypto.verify('RSA-SHA256', signingInput, publicKey, signature)) return null;

    return {
      uid: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      name: typeof payload.name === 'string' ? payload.name : undefined,
      picture: typeof payload.picture === 'string' ? payload.picture : undefined,
      exp: payload.exp,
      iat: payload.iat,
      aud: payload.aud,
      iss: payload.iss,
    };
  } catch {
    return null;
  }
}

const API_KEY = process.env.TRILL_API_KEY || '';
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const PALETTE = [
  '#00f0ff', // Vivid Neon Cyan
  '#ff007f', // Hot Magenta Pink
  '#a855f7', // Electric Violet
  '#00e676', // Bright Neon Emerald
  '#ff9100', // Electric Sunset Amber
  '#3b82f6', // Vivid Cobalt Blue
  '#f43f5e', // Radiant Crimson Rose
  '#ffe600', // Cyber Solar Yellow
  '#06b6d4', // Bright Caribbean Turquoise
  '#d946ef', // Neon Purple Fuchsia
  '#10b981', // Vivid Jade Mint
  '#6366f1', // Electric Indigo
  '#84cc16', // Bright Acid Lime
  '#fb7185', // Radiant Coral Peach
  '#14b8a6', // Vivid Deep Teal
  '#f472b6', // Radiant Orchid
];

async function requireTrillAuth(req: Request, res: Response, next: NextFunction) {
  if (!API_KEY) return next();
  const given = req.get('x-api-key') || '';
  const a = Buffer.from(given);
  const b = Buffer.from(API_KEY);
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();

  // Also allow a cryptographically verified Firebase ID token when signed in.
  const jwtUser = await verifyAndDecodeFirebaseJwt(req.headers.authorization);
  if (jwtUser) {
    (req as Request & { user?: DecodedFirebaseJwt }).user = jwtUser;
    return next();
  }
  return res.status(401).json({ error: 'Invalid or missing API key' });
}

// ============================================================================
// 3. Real-Time WebSocket Presence & Broadcast State
// ============================================================================
interface ConnectedClient {
  ws: WebSocket;
  uid: string;
  displayName: string;
  connectedAt: string;
  lastPing: string;
}

const activeClients = new Map<string, ConnectedClient>();

function broadcastSyncEvent(type: string, payload: Record<string, unknown>) {
  const message = JSON.stringify({
    type,
    timestamp: new Date().toISOString(),
    ...payload,
  });
  for (const client of activeClients.values()) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(message);
    }
  }
}

function getPresenceList() {
  const uniqueUsers = new Map<string, { uid: string; displayName: string; connectedAt: string }>();
  for (const c of activeClients.values()) {
    uniqueUsers.set(c.uid, {
      uid: c.uid,
      displayName: c.displayName,
      connectedAt: c.connectedAt,
    });
  }
  return Array.from(uniqueUsers.values());
}

// ============================================================================
// 4. Express App & Trill Face Rec REST API
// ============================================================================
async function startServer() {
  const app = express();
  // Default to the AI Studio preview port while allowing isolated test instances.
  const PORT = Number.parseInt(process.env.PORT || '', 10) || 3000;
  const HOST = process.env.HOST || '0.0.0.0';
  const httpServer = createServer(app);

  app.disable('x-powered-by');
  app.set('etag', 'strong');
  app.use(compression());
  app.use(express.json({ limit: '2mb' }));

  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.set({
      'Permissions-Policy': 'camera=*, display-capture=*',
    });
    next();
  });

  const apiRouter = express.Router();

  // Public health check (reports whether TRILL_API_KEY is required)
  apiRouter.get('/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      name: 'Trill Face Rec',
      time: Date.now(),
      authRequired: !!API_KEY,
      activeConnections: activeClients.size,
    });
  });

  // JWT verification & session audit endpoint
  apiRouter.get('/auth/verify', async (req: Request, res: Response) => {
    const decoded = await verifyAndDecodeFirebaseJwt(req.headers.authorization);
    if (!decoded) {
      res.status(401).json({ error: 'Invalid or missing Bearer JWT token.' });
      return;
    }
    res.json({
      verified: true,
      uid: decoded.uid,
      email: decoded.email || null,
      issuedAt: new Date(decoded.iat * 1000).toISOString(),
      expiresAt: new Date(decoded.exp * 1000).toISOString(),
      activePeers: getPresenceList(),
    });
  });

  // Protect Trill Face Rec routes with optional TRILL_API_KEY
  apiRouter.use(requireTrillAuth);

  const now = () => Date.now();
  const bad = (res: Response, msg: string) => res.status(400).json({ error: msg });

  function validName(name: unknown): name is string {
    return typeof name === 'string' && name.trim().length >= 1 && name.trim().length <= 80;
  }

  function validDescriptor(d: unknown): d is number[] {
    return (
      Array.isArray(d) &&
      d.length === DESCRIPTOR_LEN &&
      d.every((n) => typeof n === 'number' && Number.isFinite(n))
    );
  }

  interface PersonDbRow {
    id: number;
    name: string;
    notes: string;
    color: string;
    created_at: number;
    updated_at: number;
    face_count?: number;
  }

  function personRow(id: string | number): PersonDbRow | undefined {
    return db.prepare('SELECT * FROM people WHERE id = ?').get(id) as PersonDbRow | undefined;
  }

  function serializePerson(p: PersonDbRow) {
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

  function pickColor(): string {
    const counts = db.prepare('SELECT color, COUNT(*) c FROM people GROUP BY color').all() as {
      color: string;
      c: number;
    }[];
    const used = new Map(counts.map((r) => [r.color.toLowerCase(), r.c]));
    let best = PALETTE[0];
    let bestCount = Infinity;
    for (const c of PALETTE) {
      const n = used.get(c) || 0;
      if (n < bestCount) {
        best = c;
        bestCount = n;
      }
    }
    return best;
  }

  function decodeImage(dataUrl: unknown): { buf: Buffer; ext: string } | null {
    if (typeof dataUrl !== 'string') return null;
    const m = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!m) return null;
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) return null;
    return { buf, ext: m[1] === 'png' ? 'png' : m[1] === 'webp' ? 'webp' : 'jpg' };
  }

  function saveThumb(decoded: { buf: Buffer; ext: string }): string {
    const name = `${crypto.randomUUID()}.${decoded.ext}`;
    fs.writeFileSync(path.join(FACE_DIR, name), decoded.buf);
    return name;
  }

  function removeThumb(name: string | null | undefined) {
    if (!name) return;
    const safe = path.basename(name);
    fs.promises.unlink(path.join(FACE_DIR, safe)).catch(() => {});
  }

  // ---- stats ----
  apiRouter.get('/stats', (_req: Request, res: Response) => {
    const people = (db.prepare('SELECT COUNT(*) n FROM people').get() as { n: number }).n;
    const faces = (db.prepare('SELECT COUNT(*) n FROM faces').get() as { n: number }).n;
    const events = (db.prepare('SELECT COUNT(*) n FROM events').get() as { n: number }).n;
    const today = (
      db
        .prepare('SELECT COUNT(*) n FROM events WHERE created_at >= ?')
        .get(new Date().setHours(0, 0, 0, 0)) as { n: number }
    ).n;
    res.json({ people, faces, events, eventsToday: today });
  });

  // ---- people ----
  const listPeople = db.prepare(`
    SELECT p.*, (SELECT COUNT(*) FROM faces f WHERE f.person_id = p.id) AS face_count
    FROM people p ORDER BY p.name COLLATE NOCASE
  `);

  apiRouter.get('/people', (_req: Request, res: Response) => {
    const rows = listPeople.all() as PersonDbRow[];
    res.json(rows.map(serializePerson));
  });

  apiRouter.post('/people', (req: Request, res: Response) => {
    const { name, notes = '', color } = req.body || {};
    if (!validName(name)) return bad(res, 'Name must be 1-80 characters');
    if (color && !HEX_COLOR.test(color)) return bad(res, 'Color must be #rrggbb');
    const clean = name.trim();
    if (db.prepare('SELECT 1 FROM people WHERE name = ?').get(clean)) {
      return res.status(409).json({ error: 'A person with that name already exists' });
    }
    const t = now();
    const info = db
      .prepare('INSERT INTO people (name, notes, color, created_at, updated_at) VALUES (?,?,?,?,?)')
      .run(clean, String(notes).slice(0, 2000), color || pickColor(), t, t);
    const created = personRow(Number(info.lastInsertRowid))!;
    broadcastSyncEvent('gallery_changed', { action: 'person_created', personId: created.id, name: created.name });
    return res.status(201).json(serializePerson({ ...created, face_count: 0 }));
  });

  apiRouter.get('/people/:id', (req: Request, res: Response) => {
    const p = personRow(req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    const faceCount = (
      db.prepare('SELECT COUNT(*) n FROM faces WHERE person_id = ?').get(p.id) as { n: number }
    ).n;
    return res.json(serializePerson({ ...p, face_count: faceCount }));
  });

  apiRouter.patch('/people/:id', (req: Request, res: Response) => {
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
    db.prepare('UPDATE people SET name=?, notes=?, color=?, updated_at=? WHERE id=?').run(
      next.name,
      next.notes,
      next.color,
      now(),
      p.id
    );
    // Keep historical event labels in sync with the new name
    db.prepare('UPDATE events SET label = ? WHERE person_id = ?').run(next.name, p.id);
    const updated = personRow(p.id)!;
    const faceCount = (
      db.prepare('SELECT COUNT(*) n FROM faces WHERE person_id = ?').get(p.id) as { n: number }
    ).n;
    broadcastSyncEvent('gallery_changed', { action: 'person_updated', personId: p.id, name: next.name });
    return res.json(serializePerson({ ...updated, face_count: faceCount }));
  });

  apiRouter.delete('/people/:id', (req: Request, res: Response) => {
    const p = personRow(req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    const files = db
      .prepare('SELECT thumb_file FROM faces WHERE person_id = ?')
      .all(p.id) as { thumb_file: string | null }[];
    db.prepare('DELETE FROM people WHERE id = ?').run(p.id);
    files.forEach((f) => removeThumb(f.thumb_file));
    broadcastSyncEvent('gallery_changed', { action: 'person_deleted', personId: p.id });
    return res.json({ ok: true, deletedFaces: files.length });
  });

  // ---- faces (enrolled samples) ----
  apiRouter.get('/people/:id/faces', (req: Request, res: Response) => {
    const p = personRow(req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    const rows = db
      .prepare('SELECT id, thumb_file, source, created_at FROM faces WHERE person_id = ? ORDER BY created_at DESC')
      .all(p.id) as { id: number; thumb_file: string | null; source: string; created_at: number }[];
    return res.json(
      rows.map((r) => ({
        id: r.id,
        source: r.source,
        createdAt: r.created_at,
        thumbUrl: r.thumb_file ? `faces/${r.id}/thumb` : null,
      }))
    );
  });

  apiRouter.post('/people/:id/faces', (req: Request, res: Response) => {
    const p = personRow(req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    const { descriptor, image, source = 'camera' } = req.body || {};
    if (!validDescriptor(descriptor)) {
      return bad(res, `descriptor must be ${DESCRIPTOR_LEN} finite numbers`);
    }
    let thumb: string | null = null;
    if (image) {
      const decoded = decodeImage(image);
      if (!decoded) return bad(res, 'image must be a jpeg/png/webp data URL under 1.5MB');
      thumb = saveThumb(decoded);
    }
    const info = db
      .prepare('INSERT INTO faces (person_id, descriptor, thumb_file, source, created_at) VALUES (?,?,?,?,?)')
      .run(p.id, descriptorToBlob(descriptor), thumb, String(source).slice(0, 32), now());
    db.prepare('UPDATE people SET updated_at = ? WHERE id = ?').run(now(), p.id);
    const faceId = Number(info.lastInsertRowid);

    // Automatically remove similar unknown intruder snapshots now that this person/face is registered!
    const intruderRows = db
      .prepare('SELECT id, descriptor, thumb_file FROM intruders WHERE descriptor IS NOT NULL')
      .all() as { id: number; descriptor: Buffer; thumb_file: string | null }[];

    let prunedSimilarIntruders = 0;
    const newVector = descriptor as number[];
    for (const intr of intruderRows) {
      const iVec = blobToArray(intr.descriptor);
      let s = 0;
      for (let k = 0; k < 128; k++) {
        const diff = newVector[k] - iVec[k];
        s += diff * diff;
      }
      if (Math.sqrt(s) < 0.40) {
        db.prepare('DELETE FROM intruders WHERE id = ?').run(intr.id);
        removeThumb(intr.thumb_file);
        prunedSimilarIntruders++;
      }
    }

    broadcastSyncEvent('gallery_changed', { action: 'face_added', personId: p.id, faceId, prunedSimilarIntruders });
    return res.status(201).json({
      id: faceId,
      personId: p.id,
      thumbUrl: thumb ? `faces/${faceId}/thumb` : null,
      prunedSimilarIntruders,
    });
  });

  apiRouter.get('/faces/:id/thumb', (req: Request, res: Response) => {
    const row = db
      .prepare('SELECT thumb_file FROM faces WHERE id = ?')
      .get(req.params.id) as { thumb_file: string | null } | undefined;
    if (!row || !row.thumb_file) return res.status(404).end();
    const file = path.join(FACE_DIR, path.basename(row.thumb_file));
    if (!fs.existsSync(file)) return res.status(404).end();
    res.set('Cache-Control', 'private, max-age=86400');
    return res.sendFile(file);
  });

  apiRouter.delete('/faces/:id', (req: Request, res: Response) => {
    const row = db
      .prepare('SELECT thumb_file FROM faces WHERE id = ?')
      .get(req.params.id) as { thumb_file: string | null } | undefined;
    if (!row) return res.status(404).json({ error: 'Not found' });
    db.prepare('DELETE FROM faces WHERE id = ?').run(req.params.id);
    removeThumb(row.thumb_file);
    broadcastSyncEvent('gallery_changed', { action: 'face_deleted', faceId: Number(req.params.id) });
    return res.json({ ok: true });
  });

  // ---- gallery (what devices download to recognize offline) ----
  apiRouter.get('/gallery', (_req: Request, res: Response) => {
    const people = listPeople.all() as PersonDbRow[];
    const rows = db
      .prepare('SELECT id, person_id, descriptor FROM faces ORDER BY id')
      .all() as { id: number; person_id: number; descriptor: Buffer }[];
    const byPerson = new Map<number, number[][]>();
    for (const r of rows) {
      if (!byPerson.has(r.person_id)) byPerson.set(r.person_id, []);
      byPerson.get(r.person_id)!.push(blobToArray(r.descriptor));
    }
    return res.json({
      version: now(),
      people: people.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        descriptors: byPerson.get(p.id) || [],
      })),
    });
  });

  // ---- recognition events ----
  apiRouter.post('/events', (req: Request, res: Response) => {
    const { personId = null, label, status, distance = null, device = '' } = req.body || {};
    if (!['match', 'possible', 'unknown'].includes(status)) return bad(res, 'status invalid');
    if (typeof label !== 'string' || !label.trim()) return bad(res, 'label required');
    const exists =
      personId != null && db.prepare('SELECT 1 FROM people WHERE id = ?').get(personId);
    const dist = typeof distance === 'number' && Number.isFinite(distance) ? distance : null;
    const t = now();
    const info = db
      .prepare(
        'INSERT INTO events (person_id, label, status, distance, device, created_at) VALUES (?,?,?,?,?,?)'
      )
      .run(exists ? personId : null, label.slice(0, 80), status, dist, String(device).slice(0, 80), t);
    const eventId = Number(info.lastInsertRowid);
    broadcastSyncEvent('recognition_event', {
      id: eventId,
      personId: exists ? personId : null,
      label: label.slice(0, 80),
      status,
      distance: dist,
      device: String(device).slice(0, 80),
      createdAt: t,
    });
    return res.status(201).json({ id: eventId });
  });

  apiRouter.get('/events', (req: Request, res: Response) => {
    const limit = Math.min(parseInt(String(req.query.limit || '100'), 10) || 100, 500);
    const rows = db
      .prepare('SELECT * FROM events ORDER BY created_at DESC LIMIT ?')
      .all(limit) as {
      id: number;
      person_id: number | null;
      label: string;
      status: string;
      distance: number | null;
      device: string;
      created_at: number;
    }[];
    return res.json(
      rows.map((r) => ({
        id: r.id,
        personId: r.person_id,
        label: r.label,
        status: r.status,
        distance: r.distance,
        device: r.device,
        createdAt: r.created_at,
      }))
    );
  });

  apiRouter.delete('/events', (_req: Request, res: Response) => {
    const info = db.prepare('DELETE FROM events').run();
    broadcastSyncEvent('events_cleared', { deleted: info.changes });
    return res.json({ ok: true, deleted: info.changes });
  });

  // ---- intruder snapshots (auto-snapped unknown faces) ----
  apiRouter.post('/intruders', (req: Request, res: Response) => {
    const { image, descriptor, note = '', distance = null, label = 'Unknown Subject' } = req.body || {};
    let thumb: string | null = null;
    if (image) {
      const decoded = decodeImage(image);
      if (decoded) thumb = saveThumb(decoded);
    }
    const descBlob = validDescriptor(descriptor) ? descriptorToBlob(descriptor) : null;
    const t = now();
    const info = db
      .prepare(
        'INSERT INTO intruders (thumb_file, descriptor, label, note, distance, created_at) VALUES (?,?,?,?,?,?)'
      )
      .run(thumb, descBlob, String(label).slice(0, 80), String(note).slice(0, 200), distance, t);

    const intruderId = Number(info.lastInsertRowid);
    broadcastSyncEvent('intruder_snapped', {
      id: intruderId,
      label,
      hasThumb: !!thumb,
      createdAt: t,
    });
    return res.status(201).json({
      id: intruderId,
      thumbUrl: thumb ? `intruders/${intruderId}/thumb` : null,
      createdAt: t,
    });
  });

  apiRouter.get('/intruders', (req: Request, res: Response) => {
    const limit = Math.min(parseInt(String(req.query.limit || '60'), 10) || 60, 200);
    const rows = db
      .prepare('SELECT id, thumb_file, label, note, distance, created_at FROM intruders ORDER BY created_at DESC LIMIT ?')
      .all(limit) as {
      id: number;
      thumb_file: string | null;
      label: string;
      note: string;
      distance: number | null;
      created_at: number;
    }[];
    return res.json(
      rows.map((r) => ({
        id: r.id,
        label: r.label,
        note: r.note,
        distance: r.distance,
        thumbUrl: r.thumb_file ? `intruders/${r.id}/thumb` : null,
        createdAt: r.created_at,
      }))
    );
  });

  apiRouter.get('/intruders/:id/thumb', (req: Request, res: Response) => {
    const row = db
      .prepare('SELECT thumb_file FROM intruders WHERE id = ?')
      .get(req.params.id) as { thumb_file: string | null } | undefined;
    if (!row || !row.thumb_file) return res.status(404).end();
    const file = path.join(FACE_DIR, path.basename(row.thumb_file));
    if (!fs.existsSync(file)) return res.status(404).end();
    res.set('Cache-Control', 'private, max-age=86400');
    return res.sendFile(file);
  });

  apiRouter.delete('/intruders/:id', (req: Request, res: Response) => {
    const row = db
      .prepare('SELECT thumb_file FROM intruders WHERE id = ?')
      .get(req.params.id) as { thumb_file: string | null } | undefined;
    if (!row) return res.status(404).json({ error: 'Not found' });
    db.prepare('DELETE FROM intruders WHERE id = ?').run(req.params.id);
    removeThumb(row.thumb_file);
    broadcastSyncEvent('intruder_deleted', { id: Number(req.params.id) });
    return res.json({ ok: true });
  });

  apiRouter.delete('/intruders', (_req: Request, res: Response) => {
    const files = db
      .prepare('SELECT thumb_file FROM intruders')
      .all() as { thumb_file: string | null }[];
    const info = db.prepare('DELETE FROM intruders').run();
    files.forEach((f) => removeThumb(f.thumb_file));
    broadcastSyncEvent('intruders_cleared', { deleted: info.changes });
    return res.json({ ok: true, deleted: info.changes });
  });

  // Promote an intruder snapshot into an enrolled person
  apiRouter.post('/intruders/:id/enroll', (req: Request, res: Response) => {
    const intruder = db
      .prepare('SELECT * FROM intruders WHERE id = ?')
      .get(req.params.id) as {
      id: number;
      thumb_file: string | null;
      descriptor: Buffer | null;
      label: string;
      created_at: number;
    } | undefined;
    if (!intruder) return res.status(404).json({ error: 'Intruder not found' });
    if (!intruder.descriptor) return bad(res, 'Intruder has no biometric descriptor');

    const { personId, name } = req.body || {};
    let targetPersonId: number;

    if (personId != null) {
      const p = personRow(personId);
      if (!p) return bad(res, 'Person does not exist');
      targetPersonId = p.id;
    } else {
      if (!validName(name)) return bad(res, 'Name must be 1-80 characters');
      const clean = name.trim();
      const existing = db.prepare('SELECT id FROM people WHERE name = ?').get(clean) as { id: number } | undefined;
      if (existing) {
        targetPersonId = existing.id;
      } else {
        const t = now();
        const info = db
          .prepare('INSERT INTO people (name, notes, color, created_at, updated_at) VALUES (?,?,?,?,?)')
          .run(clean, 'Enrolled from security intruder snapshot', pickColor(), t, t);
        targetPersonId = Number(info.lastInsertRowid);
      }
    }

    // Move face into faces table
    const faceInfo = db
      .prepare('INSERT INTO faces (person_id, descriptor, thumb_file, source, created_at) VALUES (?,?,?,?,?)')
      .run(targetPersonId, intruder.descriptor, intruder.thumb_file, 'security_snap', now());
    const newFaceId = Number(faceInfo.lastInsertRowid);

    // Remove from intruders table
    db.prepare('DELETE FROM intruders WHERE id = ?').run(intruder.id);

    // Also automatically prune any similar unknown intruder snapshots of this person
    const intruderDesc = blobToArray(intruder.descriptor);
    const otherIntruders = db
      .prepare('SELECT id, descriptor, thumb_file FROM intruders WHERE descriptor IS NOT NULL')
      .all() as { id: number; descriptor: Buffer; thumb_file: string | null }[];

    let prunedSimilarIntruders = 0;
    for (const oi of otherIntruders) {
      const d = blobToArray(oi.descriptor);
      let s = 0;
      for (let i = 0; i < 128; i++) {
        const diff = intruderDesc[i] - d[i];
        s += diff * diff;
      }
      if (Math.sqrt(s) < 0.38) {
        db.prepare('DELETE FROM intruders WHERE id = ?').run(oi.id);
        removeThumb(oi.thumb_file);
        prunedSimilarIntruders++;
      }
    }

    broadcastSyncEvent('gallery_changed', { action: 'face_added', personId: targetPersonId, faceId: newFaceId });
    return res.json({
      ok: true,
      personId: targetPersonId,
      faceId: newFaceId,
      prunedSimilarIntruders,
    });
  });

  // ---- biometric deduplication & sample optimizer ----
  // Removes redundant, similar face samples for registered people
  apiRouter.post('/dedup', (req: Request, res: Response) => {
    const { personId, threshold = 0.25, purgeSimilarIntruders = true } = req.body || {};
    const cut = typeof threshold === 'number' && threshold > 0.05 && threshold < 0.60 ? threshold : 0.25;

    const peopleList = personId != null
      ? db.prepare('SELECT id, name FROM people WHERE id = ?').all(personId) as { id: number; name: string }[]
      : db.prepare('SELECT id, name FROM people').all() as { id: number; name: string }[];

    let totalPruned = 0;
    let peopleOptimized = 0;

    for (const p of peopleList) {
      const faces = db
        .prepare('SELECT id, descriptor, thumb_file FROM faces WHERE person_id = ? ORDER BY id ASC')
        .all(p.id) as { id: number; descriptor: Buffer; thumb_file: string | null }[];

      if (faces.length <= 1) continue;

      const toDelete = new Set<number>();
      const parsed = faces.map((f) => ({ id: f.id, thumb: f.thumb_file, arr: blobToArray(f.descriptor) }));

      for (let i = 0; i < parsed.length; i++) {
        if (toDelete.has(parsed[i].id)) continue;
        for (let j = i + 1; j < parsed.length; j++) {
          if (toDelete.has(parsed[j].id)) continue;

          let s = 0;
          for (let k = 0; k < 128; k++) {
            const diff = parsed[i].arr[k] - parsed[j].arr[k];
            s += diff * diff;
          }
          const dist = Math.sqrt(s);

          // If distance is below threshold, samples are redundant duplicates!
          if (dist < cut) {
            toDelete.add(parsed[j].id);
          }
        }
      }

      for (const id of toDelete) {
        const row = parsed.find((f) => f.id === id);
        db.prepare('DELETE FROM faces WHERE id = ?').run(id);
        removeThumb(row?.thumb);
        totalPruned++;
      }

      if (toDelete.size > 0) peopleOptimized++;
    }

    // Optionally also purge intruder snapshots that match any registered person
    let purgedIntruders = 0;
    if (purgeSimilarIntruders) {
      const allRegFaces = db
        .prepare('SELECT descriptor FROM faces')
        .all() as { descriptor: Buffer }[];
      const regVectors = allRegFaces.map((f) => blobToArray(f.descriptor));

      const intruderRows = db
        .prepare('SELECT id, descriptor, thumb_file FROM intruders WHERE descriptor IS NOT NULL')
        .all() as { id: number; descriptor: Buffer; thumb_file: string | null }[];

      for (const intr of intruderRows) {
        const iVec = blobToArray(intr.descriptor);
        let match = false;
        for (const rVec of regVectors) {
          let s = 0;
          for (let k = 0; k < 128; k++) {
            const diff = iVec[k] - rVec[k];
            s += diff * diff;
          }
          if (Math.sqrt(s) < 0.38) {
            match = true;
            break;
          }
        }
        if (match) {
          db.prepare('DELETE FROM intruders WHERE id = ?').run(intr.id);
          removeThumb(intr.thumb_file);
          purgedIntruders++;
        }
      }
    }

    if (totalPruned > 0) {
      broadcastSyncEvent('gallery_changed', { action: 'dedup_completed', pruned: totalPruned });
    }

    const remainingFaces = (db.prepare('SELECT COUNT(*) n FROM faces').get() as { n: number }).n;
    return res.json({
      ok: true,
      threshold: cut,
      prunedCount: totalPruned,
      peopleOptimized,
      purgedIntruders,
      remainingFaces,
    });
  });

  apiRouter.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Unknown API route' });
  });

  app.use('/api', apiRouter);

  // ============================================================================
  // 5. Static PWA Assets: Service Worker, Manifest, Models, Vendor
  // ============================================================================
  const publicDir = path.join(__dirname, 'public');
  const trillClientDir = path.join(__dirname, 'trill-face-rec', 'client');

  app.get('/sw.js', (_req: Request, res: Response) => {
    res.set('Cache-Control', 'no-cache');
    res.set('Service-Worker-Allowed', '/');
    const swFile = fs.existsSync(path.join(publicDir, 'sw.js'))
      ? path.join(publicDir, 'sw.js')
      : path.join(trillClientDir, 'sw.js');
    res.type('application/javascript').sendFile(swFile);
  });

  app.get('/manifest.webmanifest', (_req: Request, res: Response) => {
    res.set('Cache-Control', 'no-cache');
    const manifestFile = fs.existsSync(path.join(publicDir, 'manifest.webmanifest'))
      ? path.join(publicDir, 'manifest.webmanifest')
      : path.join(trillClientDir, 'manifest.webmanifest');
    res.type('application/manifest+json').sendFile(manifestFile);
  });

  app.use(
    '/models',
    express.static(
      fs.existsSync(path.join(publicDir, 'models'))
        ? path.join(publicDir, 'models')
        : path.join(trillClientDir, 'models'),
      { maxAge: '7d', immutable: false }
    )
  );

  app.use(
    '/vendor',
    express.static(
      fs.existsSync(path.join(publicDir, 'vendor'))
        ? path.join(publicDir, 'vendor')
        : path.join(trillClientDir, 'vendor'),
      { maxAge: '1d' }
    )
  );

  app.use(
    '/icons',
    express.static(
      fs.existsSync(path.join(publicDir, 'icons'))
        ? path.join(publicDir, 'icons')
        : path.join(trillClientDir, 'icons'),
      { maxAge: '1d' }
    )
  );

  // ============================================================================
  // 6. WebSocket Server for Real-Time Sync across Devices
  // ============================================================================
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('error', (err) => {
    console.error('WebSocket server error:', err);
  });

  wss.on('connection', (ws: WebSocket) => {
    let clientId: string | null = null;

    ws.on('message', async (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'auth' && typeof msg.token === 'string') {
          const isAnonymous = msg.token === 'anonymous';
          const decoded = isAnonymous ? null : await verifyAndDecodeFirebaseJwt(`Bearer ${msg.token}`);
          if (!isAnonymous && !decoded) {
            ws.send(JSON.stringify({ type: 'auth_error', error: 'Invalid Firebase ID token' }));
            return;
          }

          const uid = decoded?.uid || `device_${crypto.randomUUID().slice(0, 8)}`;
          const displayName =
            typeof msg.displayName === 'string' && msg.displayName.trim()
              ? msg.displayName.trim().slice(0, 60)
              : decoded?.name || decoded?.email?.split('@')[0] || 'Trill Device';
          clientId = `${uid}_${Math.random().toString(36).slice(2, 8)}`;
          const nowIso = new Date().toISOString();

          activeClients.set(clientId, {
            ws,
            uid,
            displayName,
            connectedAt: nowIso,
            lastPing: nowIso,
          });

          ws.send(
            JSON.stringify({
              type: 'auth_ack',
              uid,
              displayName,
              connectedAt: nowIso,
              peers: getPresenceList(),
            })
          );

          broadcastSyncEvent('presence_update', {
            peers: getPresenceList(),
          });
        } else if (msg.type === 'ping' && clientId && activeClients.has(clientId)) {
          const entry = activeClients.get(clientId)!;
          entry.lastPing = new Date().toISOString();
          ws.send(JSON.stringify({ type: 'pong', timestamp: entry.lastPing }));
        }
      } catch {
        // Ignore malformed WS payloads
      }
    });

    ws.on('close', () => {
      if (clientId && activeClients.has(clientId)) {
        activeClients.delete(clientId);
        broadcastSyncEvent('presence_update', {
          peers: getPresenceList(),
        });
      }
    });
  });

  // ============================================================================
  // 7. Vite Middleware (Dev) or Static Bundle (Production)
  // ============================================================================
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      const indexFile = path.join(distPath, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Application build not found.');
      }
    });
  }

  httpServer.listen(PORT, HOST, () => {
    console.log(`Trill Face Rec server running on http://${HOST}:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
