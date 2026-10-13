// End-to-end API tests: spawns the real server against a temporary data dir.
// Run with: npm test
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3917 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'trill-test-'));
const KEY = 'test-key-123';
let proc;

// 1x1 transparent PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const desc = (seed = 0.1) => Array.from({ length: 128 }, (_, i) => Math.sin(i * seed));

async function call(method, p, body, headers = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}

before(async () => {
  proc = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR, TRILL_API_KEY: KEY },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stderr.on('data', (d) => process.stderr.write(d));
  await waitForServer();
});

after(() => {
  if (proc) proc.kill();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const AUTH = { 'x-api-key': KEY };

test('auth: rejects requests without the API key', async () => {
  const r = await call('GET', '/api/people');
  assert.equal(r.status, 401);
});

test('auth: rejects a wrong key', async () => {
  const r = await call('GET', '/api/people', undefined, { 'x-api-key': 'nope' });
  assert.equal(r.status, 401);
});

test('health is public and reports auth', async () => {
  const r = await call('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.json.authRequired, true);
});

let alice;
test('people: create, validate, and conflict handling', async () => {
  const bad = await call('POST', '/api/people', { name: '   ' }, AUTH);
  assert.equal(bad.status, 400);

  const badColor = await call('POST', '/api/people', { name: 'X', color: 'red' }, AUTH);
  assert.equal(badColor.status, 400);

  const ok = await call('POST', '/api/people', { name: 'Alice Example', notes: 'Engineer' }, AUTH);
  assert.equal(ok.status, 201);
  assert.match(ok.json.color, /^#[0-9a-f]{6}$/i);
  alice = ok.json;

  const dup = await call('POST', '/api/people', { name: 'alice example' }, AUTH);
  assert.equal(dup.status, 409, 'names are unique (case-insensitive)');
});

let faceId;
test('faces: enroll with descriptor and thumbnail', async () => {
  const bad = await call('POST', `/api/people/${alice.id}/faces`, { descriptor: [1, 2, 3] }, AUTH);
  assert.equal(bad.status, 400);

  const badImg = await call('POST', `/api/people/${alice.id}/faces`,
    { descriptor: desc(), image: 'data:text/html;base64,AAAA' }, AUTH);
  assert.equal(badImg.status, 400);

  const ok = await call('POST', `/api/people/${alice.id}/faces`, { descriptor: desc(), image: PNG, source: 'camera' }, AUTH);
  assert.equal(ok.status, 201);
  faceId = ok.json.id;
  assert.equal(ok.json.thumbUrl, `faces/${faceId}/thumb`);

  const second = await call('POST', `/api/people/${alice.id}/faces`, { descriptor: desc(0.2) }, AUTH);
  assert.equal(second.status, 201);
});

test('faces: list and thumbnail retrieval', async () => {
  const list = await call('GET', `/api/people/${alice.id}/faces`, undefined, AUTH);
  assert.equal(list.status, 200);
  assert.equal(list.json.length, 2);

  const thumb = await fetch(`${BASE}/api/faces/${faceId}/thumb`, { headers: AUTH });
  assert.equal(thumb.status, 200);
  assert.match(thumb.headers.get('content-type'), /image\/png/);
});

test('gallery: returns exact 128-d float descriptors per person', async () => {
  const r = await call('GET', '/api/gallery', undefined, AUTH);
  assert.equal(r.status, 200);
  const p = r.json.people.find((x) => x.id === alice.id);
  assert.equal(p.descriptors.length, 2);
  assert.equal(p.descriptors[0].length, 128);
  assert.ok(Math.abs(p.descriptors[0][1] - Math.sin(0.1)) < 1e-6, 'float32 round-trip');
});

test('events: logging, and label follows a rename', async () => {
  const ev = await call('POST', '/api/events',
    { personId: alice.id, label: 'Alice Example', status: 'match', distance: 0.31, device: 'test' }, AUTH);
  assert.equal(ev.status, 201);

  const bad = await call('POST', '/api/events', { label: 'x', status: 'bogus' }, AUTH);
  assert.equal(bad.status, 400);

  const rename = await call('PATCH', `/api/people/${alice.id}`, { name: 'Alice Renamed' }, AUTH);
  assert.equal(rename.status, 200);
  const log = await call('GET', '/api/events?limit=10', undefined, AUTH);
  assert.equal(log.json[0].label, 'Alice Renamed');
});

test('events: a deleted person does not break logging', async () => {
  const tmp = await call('POST', '/api/people', { name: 'Temp Person' }, AUTH);
  await call('DELETE', `/api/people/${tmp.json.id}`, undefined, AUTH);
  const ev = await call('POST', '/api/events',
    { personId: tmp.json.id, label: 'Temp Person', status: 'match', distance: 0.2 }, AUTH);
  assert.equal(ev.status, 201, 'dangling person id is tolerated');
});

test('faces: delete a sample', async () => {
  const r = await call('DELETE', `/api/faces/${faceId}`, undefined, AUTH);
  assert.equal(r.status, 200);
  const list = await call('GET', `/api/people/${alice.id}/faces`, undefined, AUTH);
  assert.equal(list.json.length, 1);
});

test('people: deleting a person cascades to samples', async () => {
  const r = await call('DELETE', `/api/people/${alice.id}`, undefined, AUTH);
  assert.equal(r.status, 200);
  assert.equal(r.json.deletedFaces, 1);
  const gone = await call('GET', `/api/people/${alice.id}`, undefined, AUTH);
  assert.equal(gone.status, 404);
  const g = await call('GET', '/api/gallery', undefined, AUTH);
  assert.ok(!g.json.people.find((x) => x.id === alice.id));
});

test('static: app shell, manifest and service worker are served', async () => {
  const html = await fetch(BASE + '/');
  assert.equal(html.status, 200);
  assert.match(await html.text(), /Trill/);
  const manifest = await fetch(BASE + '/manifest.webmanifest');
  assert.equal(manifest.status, 200);
  assert.equal((await manifest.json()).name, 'Trill Face Rec');
  const sw = await fetch(BASE + '/sw.js');
  assert.equal(sw.status, 200);
  assert.equal(sw.headers.get('cache-control'), 'no-cache');
  const model = await fetch(BASE + '/models/face_recognition_model-weights_manifest.json');
  assert.equal(model.status, 200);
});
