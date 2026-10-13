// App shell: hash router, navigation, connectivity status, service worker, and boot.
import { $, h, icon, toast } from './util.js';
import { getSettings } from './settings.js';
import { api } from './api.js';
import { getGallery } from './gallery.js';
import { flushPending } from './events.js';
import * as liveView from './views/live.js';
import * as uploadView from './views/upload.js';
import * as peopleView from './views/people.js';
import * as logView from './views/log.js';
import * as settingsView from './views/settings-view.js';

const NAV = [
  { route: 'live', label: 'Live', icon: 'live' },
  { route: 'upload', label: 'Analyze', icon: 'upload' },
  { route: 'people', label: 'People', icon: 'people' },
  { route: 'log', label: 'Log', icon: 'log' },
  { route: 'settings', label: 'Settings', icon: 'settings' },
];

const VIEWS = {
  live: liveView,
  upload: uploadView,
  people: peopleView,
  log: logView,
  settings: settingsView,
};

// ---- navigation ----
function buildNav() {
  const links = NAV.map((n) => h('a', { href: `#/${n.route}`, dataset: { route: n.route } }, icon(n.icon), h('span', {}, n.label)));
  $('#tabbar').replaceChildren(...links.map((l) => l.cloneNode(true)));
  $('#sidenav').replaceChildren(...NAV.map((n) => h('a', { href: `#/${n.route}`, dataset: { route: n.route }, class: 'side-link' },
    icon(n.icon), h('span', {}, n.label))));
}

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return { name: parts[0] || 'live', params: parts.slice(1) };
}

let cleanup = null;
let routeToken = 0;

async function route() {
  const token = ++routeToken;
  const { name, params } = parseHash();
  const key = VIEWS[name] ? name : 'live';
  const view = VIEWS[key];

  if (cleanup) {
    try { cleanup(); } catch { /* ignore */ }
    cleanup = null;
  }
  document.querySelectorAll('[data-route]').forEach((a) => {
    const on = a.dataset.route === key;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });

  const main = $('#app');
  main.replaceChildren(h('div', { class: 'view-loading' }, h('div', { class: 'spinner' })));
  window.scrollTo(0, 0);

  try {
    const result = await view.render(main, params);
    if (token !== routeToken) {
      if (typeof result === 'function') result();
      return;
    }
    main.querySelector('.view-loading')?.remove();
    cleanup = typeof result === 'function' ? result : null;
  } catch (e) {
    if (token !== routeToken) return;
    main.replaceChildren(h('div', { class: 'card' }, h('h2', {}, 'Something went wrong'), h('p', { class: 'muted' }, e.message)));
    console.error(e);
  }
}

// ---- connectivity ----
function setNet(online, label) {
  for (const el of document.querySelectorAll('[data-net]')) {
    el.className = `pill ${online ? 'on' : 'off'}`;
    el.textContent = label;
  }
}

async function checkServer() {
  try {
    const hl = await api.health();
    const needKey = hl.authRequired && !getSettings().apiKey;
    setNet(!needKey, needKey ? 'Key required' : 'Server online');
    if (!needKey) await flushPending().catch(() => {});
    return !needKey;
  } catch {
    setNet(false, navigator.onLine ? 'Server offline' : 'Offline');
    return false;
  }
}

// ---- service worker ----
async function registerSW() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  try {
    await navigator.serviceWorker.register('sw.js', { scope: './' });
  } catch (e) {
    console.warn('Service worker registration failed', e);
  }
}

// ---- boot ----
async function boot() {
  buildNav();
  window.addEventListener('hashchange', route);
  window.addEventListener('online', () => checkServer());
  window.addEventListener('offline', () => setNet(false, 'Offline'));

  if (!location.hash) location.hash = '#/live';
  await route();

  const ok = await checkServer();
  if (!ok && getSettings().apiKey === '' && location.hash !== '#/settings') {
    const hl = await api.health().catch(() => null);
    if (hl?.authRequired) {
      location.hash = '#/settings';
      toast('This server requires an API key. Enter it in Settings.', 'info', 5000);
    }
  }

  // Warm the gallery cache so recognition can start instantly and work offline.
  getGallery().catch(() => {});
  registerSW();

  $('#boot')?.classList.add('hide');
  setTimeout(() => $('#boot')?.remove(), 400);
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.deferredInstallPrompt = e;
});

boot();
