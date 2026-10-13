// The gallery is the set of enrolled face descriptors. It is fetched from the server when online
// and cached in IndexedDB so recognition keeps working offline.
import { api } from './api.js';
import { kvGet, kvSet } from './store.js';

let memo = null;

export async function getGallery({ refresh = false } = {}) {
  if (!refresh && memo) return memo;
  try {
    const g = await api.gallery();
    await kvSet('gallery', g);
    memo = g;
  } catch {
    memo = (await kvGet('gallery')) || { version: 0, people: [] };
  }
  return memo;
}

export function notifyGalleryChanged() {
  memo = null;
  window.dispatchEvent(new CustomEvent('trill:gallery-changed'));
}
