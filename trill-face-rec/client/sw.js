// Trill Face Rec service worker.
// - App shell and code: network-first (so updates land), cache fallback when offline.
// - Face models (large, immutable): cache-first.
// - API: network only; the app keeps its own offline gallery in IndexedDB.
const VERSION = 'trill-face-rec-v1.0.0';
const SHELL_CACHE = `${VERSION}-shell`;
const MODEL_CACHE = `${VERSION}-models`;

const SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/util.js',
  './js/api.js',
  './js/store.js',
  './js/settings.js',
  './js/gallery.js',
  './js/events.js',
  './js/camera.js',
  './js/engine.js',
  './js/enroll.js',
  './js/views/live.js',
  './js/views/upload.js',
  './js/views/people.js',
  './js/views/log.js',
  './js/views/settings-view.js',
  './vendor/face-api.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
];

// Core models needed for live recognition. Accurate-mode (SSD) models are cached on first use.
const CORE_MODELS = [
  'models/tiny_face_detector_model-weights_manifest.json',
  'models/tiny_face_detector_model.bin',
  'models/face_landmark_68_model-weights_manifest.json',
  'models/face_landmark_68_model.bin',
  'models/face_recognition_model-weights_manifest.json',
  'models/face_recognition_model.bin',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await shell.addAll(SHELL);
    const models = await caches.open(MODEL_CACHE);
    await models.addAll(CORE_MODELS);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, MODEL_CACHE]);
    for (const key of await caches.keys()) {
      if (!keep.has(key)) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    const hit = await cache.match(request) || await cache.match(request.url.split('?')[0]);
    if (hit) return hit;
    throw new Error('offline and not cached');
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.includes('/api/')) return; // never cache API responses

  if (url.pathname.includes('/models/')) {
    event.respondWith(cacheFirst(request, MODEL_CACHE));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(new Request('./index.html'), SHELL_CACHE).catch(() => caches.match('./index.html')));
    return;
  }

  event.respondWith(networkFirst(request, SHELL_CACHE));
});
