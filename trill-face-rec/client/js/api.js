// Thin REST client. Attaches the optional API key and normalizes errors.
import { getSettings } from './settings.js';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function authHeaders() {
  const key = getSettings().apiKey;
  return key ? { 'x-api-key': key } : {};
}

async function request(method, path, body) {
  const headers = { ...authHeaders() };
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res;
  try {
    res = await fetch(`api/${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'Server unreachable (offline?)');
  }
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.error || `Request failed (${res.status})`);
  return data;
}

const thumbCache = new Map();

export const api = {
  health: () => request('GET', 'health'),
  stats: () => request('GET', 'stats'),
  people: () => request('GET', 'people'),
  person: (id) => request('GET', `people/${id}`),
  createPerson: (p) => request('POST', 'people', p),
  updatePerson: (id, p) => request('PATCH', `people/${id}`, p),
  deletePerson: (id) => request('DELETE', `people/${id}`),
  faces: (id) => request('GET', `people/${id}/faces`),
  addFace: (id, payload) => request('POST', `people/${id}/faces`, payload),
  deleteFace: (id) => request('DELETE', `faces/${id}`),
  gallery: () => request('GET', 'gallery'),
  logEvent: (e) => request('POST', 'events', e),
  events: (limit = 200) => request('GET', `events?limit=${limit}`),
  clearEvents: () => request('DELETE', 'events'),

  // Thumbnails need the API key header, so they are fetched and turned into object URLs.
  async thumbUrl(path) {
    if (!path) return null;
    if (thumbCache.has(path)) return thumbCache.get(path);
    try {
      const res = await fetch(`api/${path}`, { headers: authHeaders() });
      if (!res.ok) return null;
      const url = URL.createObjectURL(await res.blob());
      thumbCache.set(path, url);
      return url;
    } catch {
      return null;
    }
  },
};
