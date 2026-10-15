// Root app integration tests: starts the TypeScript Express/Vite server with an
// isolated SQLite database and a local Firebase JWKS fixture.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = 3417 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'facingrec-root-test-'));
const API_KEY = 'root-test-api-key';
const PROJECT_ID = 'facingrec-test-project';
const KID = 'facingrec-test-key';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const AUTH = { 'x-api-key': API_KEY };
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const { privateKey: attackerPrivateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = {
  ...publicKey.export({ format: 'jwk' }),
  kid: KID,
  use: 'sig',
  alg: 'RS256',
};

let serverProcess;
let serverOutput = '';
let signingKeysServer;
let signingKeysUrl;

function makeToken(claims, signingKey = privateKey, algorithm = 'RS256') {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: algorithm, kid: KID, typ: 'JWT' });
  const payload = encode(claims);
  const signingInput = `${header}.${payload}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), signingKey).toString('base64url');
  return `${signingInput}.${signature}`;
}

function validClaims(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: 'runtime-user-1',
    aud: PROJECT_ID,
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    iat: now,
    exp: now + 3600,
    email: 'runtime@example.test',
    ...overrides,
  };
}

async function call(method, route, body, headers = {}) {
  const response = await fetch(`${BASE}/api${route}`, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* keep the raw response */ }
  return { status: response.status, json, text, headers: response.headers };
}

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    if (serverProcess.exitCode !== null) throw new Error(`server exited early:\n${serverOutput}`);
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) return;
    } catch { /* wait for startup */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not start:\n${serverOutput}`);
}

function connectWebSocket() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    const timeout = setTimeout(() => reject(new Error('WebSocket connection timed out')), 5000);
    ws.once('open', () => {
      clearTimeout(timeout);
      resolve(ws);
    });
    ws.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function waitForMessage(ws, type) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error(`Timed out waiting for WebSocket ${type}`));
    }, 5000);
    const onMessage = (raw) => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      if (message.type !== type) return;
      clearTimeout(timeout);
      ws.off('message', onMessage);
      resolve(message);
    };
    ws.on('message', onMessage);
  });
}

before(async () => {
  signingKeysServer = createServer((_req, res) => {
    res.writeHead(200, {
      'cache-control': 'public, max-age=300',
      'content-type': 'application/json',
    });
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise((resolve) => signingKeysServer.listen(0, '127.0.0.1', resolve));
  signingKeysUrl = `http://127.0.0.1:${signingKeysServer.address().port}/jwks`;

  serverProcess = spawn(process.execPath, ['--import', 'tsx', path.join(ROOT, 'server.ts')], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DISABLE_HMR: 'true',
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DATA_DIR,
      TRILL_API_KEY: API_KEY,
      FIREBASE_PROJECT_ID: PROJECT_ID,
      FIREBASE_SIGNING_CERTS_URL: signingKeysUrl,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProcess.stdout.on('data', (data) => { serverOutput += data.toString(); });
  serverProcess.stderr.on('data', (data) => { serverOutput += data.toString(); });
  await waitForServer();
});

after(async () => {
  if (serverProcess && serverProcess.exitCode === null) {
    const exited = new Promise((resolve) => serverProcess.once('exit', resolve));
    serverProcess.kill('SIGTERM');
    await exited;
  }
  if (signingKeysServer?.listening) {
    await new Promise((resolve) => signingKeysServer.close(resolve));
  }
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

test('root server requires a valid API key or a signed Firebase ID token', async () => {
  assert.equal((await call('GET', '/health')).json.authRequired, true);
  assert.equal((await call('GET', '/people')).status, 401);
  assert.equal((await call('GET', '/people', undefined, { 'x-api-key': 'incorrect' })).status, 401);
  assert.equal((await call('GET', '/people', undefined, AUTH)).status, 200);

  const missingToken = await call('GET', '/auth/verify');
  assert.equal(missingToken.status, 401);
  assert.deepEqual(missingToken.json, { error: 'Invalid or missing Bearer JWT token.' });

  const noExpiry = validClaims();
  delete noExpiry.exp;
  assert.equal((await call('GET', '/auth/verify', undefined, {
    authorization: `Bearer ${makeToken(noExpiry)}`,
  })).status, 401, 'a token without exp is rejected, not a 500');

  assert.equal((await call('GET', '/auth/verify', undefined, {
    authorization: `Bearer ${makeToken(validClaims({ aud: 'another-project' }))}`,
  })).status, 401);
  assert.equal((await call('GET', '/auth/verify', undefined, {
    authorization: `Bearer ${makeToken(validClaims({ iss: 'https://attacker.invalid' }))}`,
  })).status, 401);
  assert.equal((await call('GET', '/auth/verify', undefined, {
    authorization: `Bearer ${makeToken(validClaims({ exp: Math.floor(Date.now() / 1000) - 120 }))}`,
  })).status, 401);
  assert.equal((await call('GET', '/auth/verify', undefined, {
    authorization: `Bearer ${makeToken(validClaims({ iat: Math.floor(Date.now() / 1000) + 120 }))}`,
  })).status, 401);
  assert.equal((await call('GET', '/auth/verify', undefined, {
    authorization: `Bearer ${makeToken(validClaims(), attackerPrivateKey)}`,
  })).status, 401, 'forged signatures are rejected');
  assert.equal((await call('GET', '/auth/verify', undefined, {
    authorization: `Bearer ${makeToken(validClaims(), privateKey, 'none')}`,
  })).status, 401, 'non-RS256 tokens are rejected');

  const validToken = makeToken(validClaims());
  const verified = await call('GET', '/auth/verify', undefined, {
    authorization: `Bearer ${validToken}`,
  });
  assert.equal(verified.status, 200);
  assert.equal(verified.json.verified, true);
  assert.equal(verified.json.uid, 'runtime-user-1');
  assert.equal(verified.json.email, 'runtime@example.test');
  assert.equal((await call('GET', '/people', undefined, {
    authorization: `Bearer ${validToken}`,
  })).status, 200, 'a valid signed token can authenticate protected API requests');
});

test('root API CRUD, gallery, event history, intruder enrollment, and dedup work end to end', async () => {
  const desc = (seed = 0.1, offset = 0) => Array.from({ length: 128 }, (_, i) => Math.sin(i * seed) + offset);

  assert.equal((await call('POST', '/people', { name: '  ' }, AUTH)).status, 400);
  assert.equal((await call('POST', '/people', { name: 'Invalid Color', color: 'red' }, AUTH)).status, 400);
  const created = await call('POST', '/people', { name: 'Runtime Alice', notes: 'integration test' }, AUTH);
  assert.equal(created.status, 201);
  const alice = created.json;
  assert.equal((await call('POST', '/people', { name: 'runtime alice' }, AUTH)).status, 409);

  assert.equal((await call('POST', `/people/${alice.id}/faces`, { descriptor: [1, 2, 3] }, AUTH)).status, 400);
  const face = await call('POST', `/people/${alice.id}/faces`, {
    descriptor: desc(), image: PNG, source: 'test',
  }, AUTH);
  assert.equal(face.status, 201);
  const faceId = face.json.id;
  assert.equal((await call('POST', `/people/${alice.id}/faces`, {
    descriptor: desc(0.1, 0.001),
  }, AUTH)).status, 201);
  assert.equal((await call('GET', `/people/${alice.id}/faces`, undefined, AUTH)).json.length, 2);

  const thumb = await call('GET', `/faces/${faceId}/thumb`, undefined, AUTH);
  assert.equal(thumb.status, 200);
  assert.match(thumb.headers.get('content-type') || '', /image\/png/);
  const gallery = await call('GET', '/gallery', undefined, AUTH);
  const aliceInGallery = gallery.json.people.find((person) => person.id === alice.id);
  assert.equal(aliceInGallery.descriptors.length, 2);
  assert.ok(Math.abs(aliceInGallery.descriptors[0][1] - Math.sin(0.1)) < 1e-6);

  assert.equal((await call('POST', '/events', { label: 'bad', status: 'invalid' }, AUTH)).status, 400);
  assert.equal((await call('POST', '/events', {
    personId: alice.id, label: 'Runtime Alice', status: 'match', distance: 0.2,
  }, AUTH)).status, 201);
  assert.equal((await call('PATCH', `/people/${alice.id}`, { name: 'Runtime Alice Renamed' }, AUTH)).status, 200);
  assert.equal((await call('GET', '/events', undefined, AUTH)).json[0].label, 'Runtime Alice Renamed');

  const intruder = await call('POST', '/intruders', {
    image: PNG, descriptor: desc(0.3), label: 'Unknown Runtime',
  }, AUTH);
  assert.equal(intruder.status, 201);
  const enrolled = await call('POST', `/intruders/${intruder.json.id}/enroll`, { name: 'Runtime Bob' }, AUTH);
  assert.equal(enrolled.status, 200);
  assert.ok(enrolled.json.faceId);
  assert.equal((await call('GET', '/intruders', undefined, AUTH)).json.length, 0);

  assert.equal((await call('POST', '/intruders', {
    descriptor: desc(), label: 'Alice duplicate',
  }, AUTH)).status, 201);
  const dedup = await call('POST', '/dedup', { personId: alice.id }, AUTH);
  assert.equal(dedup.status, 200);
  assert.equal(dedup.json.prunedCount, 1);
  assert.equal(dedup.json.purgedIntruders, 1);
  assert.equal((await call('GET', `/people/${alice.id}/faces`, undefined, AUTH)).json.length, 1);
  assert.equal((await call('GET', '/intruders', undefined, AUTH)).json.length, 0);
  assert.equal((await call('GET', '/stats', undefined, AUTH)).json.people, 2);

  assert.equal((await call('DELETE', `/faces/${faceId}`, undefined, AUTH)).status, 200);
  assert.equal((await call('DELETE', `/people/${alice.id}`, undefined, AUTH)).json.deletedFaces, 0);
  assert.equal((await call('GET', `/people/${alice.id}`, undefined, AUTH)).status, 404);
  assert.equal((await call('DELETE', '/events', undefined, AUTH)).status, 200);
  assert.equal((await call('GET', '/not-a-route', undefined, AUTH)).status, 404);
});

test('WebSocket presence accepts valid tokens, rejects forged tokens, and handles ping', async () => {
  const invalidWs = await connectWebSocket();
  const invalidResponse = waitForMessage(invalidWs, 'auth_error');
  invalidWs.send(JSON.stringify({
    type: 'auth',
    token: makeToken(validClaims(), attackerPrivateKey),
    displayName: 'Spoofed User',
  }));
  assert.equal((await invalidResponse).error, 'Invalid Firebase ID token');
  const invalidClose = new Promise((resolve) => invalidWs.once('close', resolve));
  invalidWs.close();
  await invalidClose;

  const ws = await connectWebSocket();
  const ackResponse = waitForMessage(ws, 'auth_ack');
  ws.send(JSON.stringify({ type: 'auth', token: makeToken(validClaims()), displayName: 'Verified User' }));
  const ack = await ackResponse;
  assert.equal(ack.uid, 'runtime-user-1');
  assert.equal(ack.displayName, 'Verified User');
  assert.equal((await call('GET', '/health')).json.activeConnections, 1);

  const pongResponse = waitForMessage(ws, 'pong');
  ws.send(JSON.stringify({ type: 'ping' }));
  assert.ok((await pongResponse).timestamp);
  const close = new Promise((resolve) => ws.once('close', resolve));
  ws.close();
  await close;
});

test('root app shell, transformed React entry, PWA assets, and API failures return expected responses', async () => {
  for (const route of ['/', '/src/main.tsx', '/src/App.tsx']) {
    const response = await fetch(`${BASE}${route}`);
    assert.equal(response.status, 200, route);
    assert.ok((await response.text()).length > 0, route);
  }
  for (const route of [
    '/manifest.webmanifest',
    '/vendor/face-api.js',
    '/models/face_recognition_model-weights_manifest.json',
    '/icons/icon-192.png',
  ]) {
    const response = await fetch(`${BASE}${route}`);
    assert.equal(response.status, 200, route);
  }
  const serviceWorker = await fetch(`${BASE}/sw.js`);
  assert.equal(serviceWorker.status, 200);
  const serviceWorkerSource = await serviceWorker.text();
  assert.match(serviceWorkerSource, /root React app/);
  assert.match(serviceWorkerSource, /getAppShellUrls/);
  assert.equal((await call('GET', '/unknown', undefined, AUTH)).status, 404);
  assert.doesNotMatch(serverOutput, /Fatal server startup error|UnhandledPromiseRejection/i);
});
