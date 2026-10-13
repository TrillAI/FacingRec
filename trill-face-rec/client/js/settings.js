// User settings, persisted in localStorage. Changes are broadcast as 'trill:settings'.
const KEY = 'trill.settings.v1';

export const DEFAULTS = {
  threshold: 0.5,         // max euclidean distance for a match (lower = stricter)
  detector: 'tiny',       // 'tiny' (fast) | 'ssd' (more accurate, heavier)
  inputSize: 320,         // tiny detector input: 224 fast, 320 balanced, 416 accurate
  facing: 'user',         // 'user' | 'environment'
  mirror: true,           // mirror the front camera like a selfie view
  boxColorMode: 'status', // 'status' (green/amber/red) | 'person' (each person's color)
  logEvents: true,
  showFps: true,
  apiKey: '',
};

let cache = null;

export function getSettings() {
  if (!cache) {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* ignore corrupt */ }
    cache = { ...DEFAULTS, ...saved };
  }
  return cache;
}

export function setSettings(patch) {
  cache = { ...getSettings(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(cache));
  window.dispatchEvent(new CustomEvent('trill:settings', { detail: cache }));
  return cache;
}
