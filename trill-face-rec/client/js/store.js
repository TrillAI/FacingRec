// Tiny IndexedDB key/value store used for the offline gallery cache and the pending-event queue.
const DB_NAME = 'trill-face-rec';
let dbp = null;

function open() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function db() {
  if (!dbp) dbp = open();
  return dbp;
}

async function run(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction('kv', mode);
    const req = fn(t.objectStore('kv'));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const kvGet = (key) => run('readonly', (s) => s.get(key));
export const kvSet = (key, value) => run('readwrite', (s) => s.put(value, key));
