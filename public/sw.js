// Service worker for the root React app.
// The separate vanilla PWA has its own worker at trill-face-rec/client/sw.js.
const VERSION = 'trill-face-rec-react-v1.0.0';
const SHELL_CACHE = `${VERSION}-shell`;
const MODEL_CACHE = `${VERSION}-models`;

const CORE_MODELS = [
  '/models/tiny_face_detector_model-weights_manifest.json',
  '/models/tiny_face_detector_model.bin',
  '/models/face_landmark_68_model-weights_manifest.json',
  '/models/face_landmark_68_model.bin',
  '/models/face_recognition_model-weights_manifest.json',
  '/models/face_recognition_model.bin',
];

async function getAppShellUrls() {
  const response = await fetch('/index.html', { cache: 'reload' });
  if (!response.ok) throw new Error(`Unable to cache app shell: HTTP ${response.status}`);
  const html = await response.text();
  const urls = new Set(['/', '/index.html', '/manifest.webmanifest']);

  // Cache the app entry points in both dev and production, including Vite's
  // hashed JS/CSS files so an installed app can start without a network.
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    const url = new URL(match[1], self.location.origin);
    if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) continue;
    urls.add(`${url.pathname}${url.search}`);
  }
  return [...urls];
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await shell.addAll(await getAppShellUrls());
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

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request) || await cache.match(new URL(request.url).pathname);
    if (cached) return cached;
    return new Response('Offline and this resource is not cached.', { status: 503 });
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return new Response('Offline and this model is not cached.', { status: 503 });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (url.pathname.startsWith('/models/')) {
    event.respondWith(cacheFirst(request, MODEL_CACHE));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL_CACHE).then(async (response) => {
      if (response.ok) return response;
      return (await caches.open(SHELL_CACHE)).match('/index.html') || response;
    }));
    return;
  }

  event.respondWith(networkFirst(request, SHELL_CACHE));
});
