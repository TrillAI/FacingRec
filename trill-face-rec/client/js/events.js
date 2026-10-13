// Recognition event log. Events are posted to the server; if that fails (offline) they are queued
// locally and flushed later.
import { api } from './api.js';
import { kvGet, kvSet } from './store.js';
import { getSettings } from './settings.js';

const ua = navigator.userAgent;
const platform = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : 'Desktop';
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const DEVICE = platform + (standalone ? ' app' : ' browser');

export async function logRecognition(ev) {
  if (!getSettings().logEvents) return;
  const body = {
    personId: ev.personId ?? null,
    label: ev.label,
    status: ev.status,
    distance: ev.distance ?? null,
    device: DEVICE,
  };
  try {
    await api.logEvent(body);
  } catch (e) {
    if (e.status === 0 || e.status >= 500) {
      const q = (await kvGet('pending')) || [];
      q.push(body);
      await kvSet('pending', q.slice(-500));
    }
  }
}

export async function pendingCount() {
  return ((await kvGet('pending')) || []).length;
}

export async function flushPending() {
  const q = (await kvGet('pending')) || [];
  if (!q.length) return 0;
  let sent = 0;
  let i = 0;
  for (; i < q.length; i++) {
    try {
      await api.logEvent(q[i]);
      sent++;
    } catch (e) {
      if (e.status === 0 || e.status >= 500) break; // still offline: keep the rest
    }
  }
  await kvSet('pending', q.slice(i));
  return sent;
}
