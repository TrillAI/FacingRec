// Core Trill Face Rec Engine, REST API client, IndexedDB store, Settings, and Camera helpers
// Ported cleanly to TypeScript for seamless use in React components while preserving exact algorithms.

import { playCameraShutterSound, playBiometricLockChime, playIntruderAlertTone } from './audio';
import { voiceAnnouncer } from './speech';
import { trueColorNightVision } from './nightVision';

export type RecognitionStatus = 'match' | 'possible' | 'unknown';

export const STATUS_COLOR: Record<RecognitionStatus, string> = {
  match: '#22c55e',
  possible: '#f59e0b',
  unknown: '#ef4444',
};

export const STATUS_LABEL: Record<RecognitionStatus, string> = {
  match: 'Recognized',
  possible: 'Possible match',
  unknown: 'Unknown',
};

export const PERSON_COLORS = [
  '#00f0ff', // Vivid Neon Cyan
  '#ff007f', // Hot Magenta Pink
  '#a855f7', // Electric Violet
  '#00e676', // Bright Neon Emerald
  '#ff9100', // Electric Sunset Amber
  '#3b82f6', // Vivid Cobalt Blue
  '#f43f5e', // Radiant Crimson Rose
  '#ffe600', // Cyber Solar Yellow
  '#06b6d4', // Bright Caribbean Turquoise
  '#d946ef', // Neon Purple Fuchsia
  '#10b981', // Vivid Jade Mint
  '#6366f1', // Electric Indigo
  '#84cc16', // Bright Acid Lime
  '#fb7185', // Radiant Coral Peach
  '#14b8a6', // Vivid Deep Teal
  '#f472b6', // Radiant Orchid
];

/**
 * Returns a distinct, highly vibrant color for each person.
 * Automatically hashes person names or IDs into the colorful palette
 * so every recognized individual gets their own unique vivid color!
 */
export function getPersonColor(
  person: { id?: number; name?: string; color?: string } | null,
  status: RecognitionStatus
): string {
  if (status === 'unknown') {
    return '#ff3366'; // Glowing Neon Hot Coral for Unknown
  }
  if (status === 'possible') {
    return '#ffb703'; // Bright Luminous Gold for Possible Match
  }
  if (person?.color && person.color !== '#3b82f6') {
    return person.color;
  }
  if (person?.name) {
    let hash = 0;
    for (let i = 0; i < person.name.length; i++) {
      hash = (hash * 31 + person.name.charCodeAt(i)) >>> 0;
    }
    return PERSON_COLORS[hash % PERSON_COLORS.length];
  }
  if (person?.id != null) {
    return PERSON_COLORS[Math.abs(person.id) % PERSON_COLORS.length];
  }
  return '#00f0ff';
}

export interface TrillSettings {
  threshold: number;       // max euclidean distance for a match (lower = stricter)
  detector: 'tiny' | 'ssd'; // 'tiny' (fast) | 'ssd' (accurate)
  inputSize: number;       // tiny detector input: 224, 320, 416, 512, 608 (higher = smaller faces)
  smallFaceBoost: boolean; // ultra-sensitive small-face detection (lower threshold & high res)
  facing: 'user' | 'environment';
  mirror: boolean;         // mirror front camera like a selfie view
  boxColorMode: 'status' | 'person';
  logEvents: boolean;
  showFps: boolean;
  apiKey: string;
  autoSnapUnknown: boolean;      // Auto-snap evidence photo of unknown faces
  autoSnapCooldownSec: number;  // Cooldown between snaps per unknown track
  voiceAnnounce: boolean;       // Optional voice announcement: "[Name] was recognized"
  voiceAnnounceCooldownSec: number;
  soundEffects: boolean;        // Tactile biometric and shutter audio
  nightVisionMode: 'off' | 'trueColor' | 'irMono'; // Day-Referenced TrueColor Night-to-Day
  daylightProfile: string;      // 'sunny_outdoor' | 'commercial_office' | 'golden_hour' | 'custom_daytime'
  dvrContinuousBuffer: boolean; // Continuous 60s background DVR rolling buffer
}

export const SETTINGS_DEFAULTS: TrillSettings = {
  threshold: 0.50,
  detector: 'tiny',
  inputSize: 416, // 416 provides great balance for small & distant faces
  smallFaceBoost: false,
  facing: 'user',
  mirror: true,
  boxColorMode: 'person', // Default to colorful individual person colors!
  logEvents: true,
  showFps: true,
  apiKey: '',
  autoSnapUnknown: true,
  autoSnapCooldownSec: 15,
  voiceAnnounce: false, // Optional feature as requested by user
  voiceAnnounceCooldownSec: 15,
  soundEffects: true,
  nightVisionMode: 'off',
  daylightProfile: 'sunny_outdoor',
  dvrContinuousBuffer: true,
};

const SETTINGS_KEY = 'trill.settings.v1';
let settingsCache: TrillSettings | null = null;

export function getSettings(): TrillSettings {
  if (!settingsCache) {
    let saved: Partial<TrillSettings> = {};
    try {
      saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    } catch {
      // ignore corrupt storage
    }
    settingsCache = { ...SETTINGS_DEFAULTS, ...saved };
  }
  return settingsCache;
}

export function setSettings(patch: Partial<TrillSettings>): TrillSettings {
  settingsCache = { ...getSettings(), ...patch };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settingsCache));
  window.dispatchEvent(new CustomEvent('trill:settings', { detail: settingsCache }));
  return settingsCache;
}

// ============================================================================
// IndexedDB Offline Key-Value Store (Gallery cache & Pending Event Queue)
// ============================================================================
const DB_NAME = 'trill-face-rec';
let dbPromise: Promise<IDBDatabase> | null = null;

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains('kv')) {
        r.result.createObjectStore('kv');
      }
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function getIdb(): Promise<IDBDatabase> {
  if (!dbPromise) dbPromise = openIdb();
  return dbPromise;
}

async function runIdb<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await getIdb();
  return new Promise((resolve, reject) => {
    const t = d.transaction('kv', mode);
    const req = fn(t.objectStore('kv'));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const kvGet = <T = unknown>(key: string): Promise<T | undefined> =>
  runIdb('readonly', (s) => s.get(key));

export const kvSet = (key: string, value: unknown): Promise<IDBValidKey> =>
  runIdb('readwrite', (s) => s.put(value, key));

// ============================================================================
// Thin REST Client for Trill Face Rec API
// ============================================================================
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface TrillPerson {
  id: number;
  name: string;
  notes: string;
  color: string;
  createdAt: number;
  updatedAt: number;
  faceCount?: number;
}

export interface TrillFaceSample {
  id: number;
  source: string;
  createdAt: number;
  thumbUrl: string | null;
}

export interface TrillGalleryPerson {
  id: number;
  name: string;
  color: string;
  descriptors: number[][];
}

export interface TrillGalleryData {
  version: number;
  people: TrillGalleryPerson[];
}

export interface TrillRecognitionEvent {
  id: number;
  personId: number | null;
  label: string;
  status: RecognitionStatus;
  distance: number | null;
  device: string;
  createdAt: number;
}

export interface TrillStats {
  people: number;
  faces: number;
  events: number;
  eventsToday: number;
}

export interface TrillIntruderSnapshot {
  id: number;
  label: string;
  note: string;
  distance: number | null;
  thumbUrl: string | null;
  createdAt: number;
}

let currentBearerToken: string | null = null;
export function setApiBearerToken(token: string | null) {
  currentBearerToken = token;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const key = getSettings().apiKey;
  if (key) headers['x-api-key'] = key;
  if (currentBearerToken) headers['Authorization'] = `Bearer ${currentBearerToken}`;
  return headers;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { ...authHeaders() };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new ApiError(0, 'Offline — server unreachable');
  }
  let res: Response;
  try {
    res = await fetch(`/api/${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Offline — server unreachable');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || `HTTP ${res.status}`);
  return data as T;
}

const thumbCache = new Map<string, string>();
window.addEventListener('trill:settings', () => thumbCache.clear());

export const api = {
  health: () =>
    request<{ ok: boolean; name: string; time: number; authRequired: boolean; activeConnections?: number }>(
      'GET',
      'health'
    ),
  stats: () => request<TrillStats>('GET', 'stats'),
  people: () => request<TrillPerson[]>('GET', 'people'),
  person: (id: number | string) => request<TrillPerson>('GET', `people/${id}`),
  createPerson: (body: { name: string; notes?: string; color?: string }) =>
    request<TrillPerson>('POST', 'people', body),
  updatePerson: (id: number | string, body: { name?: string; notes?: string; color?: string }) =>
    request<TrillPerson>('PATCH', `people/${id}`, body),
  deletePerson: (id: number | string) =>
    request<{ ok: boolean; deletedFaces: number }>('DELETE', `people/${id}`),
  faces: (personId: number | string) =>
    request<TrillFaceSample[]>('GET', `people/${personId}/faces`),
  addFace: (
    personId: number | string,
    body: { descriptor: number[]; image?: string; source?: string }
  ) =>
    request<{ id: number; personId: number; thumbUrl: string | null }>(
      'POST',
      `people/${personId}/faces`,
      body
    ),
  deleteFace: (faceId: number | string) => request<{ ok: boolean }>('DELETE', `faces/${faceId}`),
  gallery: () => request<TrillGalleryData>('GET', 'gallery'),
  events: (limit = 100) => request<TrillRecognitionEvent[]>('GET', `events?limit=${limit}`),
  logEvent: (body: {
    personId: number | null;
    label: string;
    status: RecognitionStatus;
    distance: number | null;
    device: string;
  }) => request<{ id: number }>('POST', 'events', body),
  clearEvents: () => request<{ ok: boolean; deleted: number }>('DELETE', 'events'),

  // Intruder snapshots (auto-snapped unknown faces)
  intruders: (limit = 60) => request<TrillIntruderSnapshot[]>('GET', `intruders?limit=${limit}`),
  addIntruder: (body: {
    image?: string;
    descriptor?: number[];
    note?: string;
    distance?: number | null;
    label?: string;
  }) => request<{ id: number; thumbUrl: string | null; createdAt: number }>('POST', 'intruders', body),
  deleteIntruder: (id: number | string) => request<{ ok: boolean }>('DELETE', `intruders/${id}`),
  clearIntruders: () => request<{ ok: boolean; deleted: number }>('DELETE', 'intruders'),
  enrollIntruder: (id: number | string, body: { personId?: number; name?: string }) =>
    request<{ ok: boolean; personId: number; faceId: number; prunedSimilarIntruders: number }>(
      'POST',
      `intruders/${id}/enroll`,
      body
    ),

  // Biometric Deduplication & Sample Pruner
  dedup: (body?: { personId?: number; threshold?: number; purgeSimilarIntruders?: boolean }) =>
    request<{
      ok: boolean;
      threshold: number;
      prunedCount: number;
      peopleOptimized: number;
      purgedIntruders: number;
      remainingFaces: number;
    }>('POST', 'dedup', body || {}),

  async thumbUrl(path: string | null | undefined): Promise<string | null> {
    if (!path) return null;
    if (thumbCache.has(path)) return thumbCache.get(path)!;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return null;
    try {
      const res = await fetch(`/api/${path}`, { headers: authHeaders() });
      if (!res.ok) return null;
      const url = URL.createObjectURL(await res.blob());
      thumbCache.set(path, url);
      return url;
    } catch {
      return null;
    }
  },
};

// ============================================================================
// Gallery Cache & Offline Sync
// ============================================================================
let galleryMemo: TrillGalleryData | null = null;

export async function getGallery({ refresh = false } = {}): Promise<TrillGalleryData> {
  if (!refresh && galleryMemo) return galleryMemo;
  try {
    const g = await api.gallery();
    await kvSet('gallery', g);
    galleryMemo = g;
  } catch {
    galleryMemo = (await kvGet<TrillGalleryData>('gallery')) || { version: 0, people: [] };
  }
  return galleryMemo;
}

export function notifyGalleryChanged() {
  galleryMemo = null;
  window.dispatchEvent(new CustomEvent('trill:gallery-changed'));
}

// ============================================================================
// Recognition Event Log & Offline Queue
// ============================================================================
const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
const platform = /iPhone/.test(ua)
  ? 'iPhone'
  : /iPad/.test(ua)
  ? 'iPad'
  : /Android/.test(ua)
  ? 'Android'
  : 'Desktop';
const isStandalone =
  typeof window !== 'undefined' &&
  (window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true);
export const DEVICE_NAME = `${platform}${isStandalone ? ' app' : ' browser'}`;

export interface QueuedEventBody {
  personId: number | null;
  label: string;
  status: RecognitionStatus;
  distance: number | null;
  device: string;
}

export async function logRecognition(ev: {
  personId?: number | null;
  label: string;
  status: RecognitionStatus;
  distance?: number | null;
}) {
  if (!getSettings().logEvents) return;
  const body: QueuedEventBody = {
    personId: ev.personId ?? null,
    label: ev.label,
    status: ev.status,
    distance: ev.distance ?? null,
    device: DEVICE_NAME,
  };
  try {
    await api.logEvent(body);
  } catch (e) {
    const err = e as ApiError;
    if (err.status === 0 || err.status >= 500) {
      const q = (await kvGet<QueuedEventBody[]>('pending')) || [];
      q.push(body);
      await kvSet('pending', q.slice(-500));
    }
  }
}

export async function pendingCount(): Promise<number> {
  return ((await kvGet<QueuedEventBody[]>('pending')) || []).length;
}

export async function flushPending(): Promise<number> {
  const q = (await kvGet<QueuedEventBody[]>('pending')) || [];
  if (!q.length) return 0;
  let sent = 0;
  let i = 0;
  for (; i < q.length; i++) {
    try {
      await api.logEvent(q[i]);
      sent++;
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 0 || err.status >= 500) break;
    }
  }
  await kvSet('pending', q.slice(i));
  return sent;
}

// ============================================================================
// Camera & Image Utilities
// ============================================================================
export async function startCamera(
  video: HTMLVideoElement,
  facing: 'user' | 'environment' = 'user'
): Promise<MediaStream> {
  stopCamera(video);
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      'Camera not available. Open this app over HTTPS (or localhost) in a current browser.'
    );
  }
  const want: MediaStreamConstraints = {
    audio: false,
    video: {
      facingMode: { ideal: facing },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  };
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(want);
  } catch (e) {
    const err = e as Error;
    if (err.name === 'OverconstrainedError') {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
    } else {
      throw e;
    }
  }
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play().catch(() => {});
  if (video.readyState < 2) {
    await new Promise<void>((r) =>
      video.addEventListener('loadeddata', () => r(), { once: true })
    );
  }
  return stream;
}

export function stopCamera(video: HTMLVideoElement | null) {
  if (!video) return;
  const s = video.srcObject as MediaStream | null;
  if (s?.getTracks) s.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
}

export async function startScreenShare(video: HTMLVideoElement): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error(
      'Screen and browser tab sharing is not supported by your browser. Please use Chrome, Edge, or a modern desktop browser.'
    );
  }
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: {
      cursor: 'always',
      displaySurface: 'browser',
    } as MediaTrackConstraints,
    audio: false,
  });
  stopCamera(video);
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play().catch(() => {});
  if (video.readyState < 2) {
    await new Promise<void>((r) =>
      video.addEventListener('loadeddata', () => r(), { once: true })
    );
  }
  return stream;
}

export function loadImage(file: File): Promise<{ img: HTMLImageElement; url: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image'));
    };
    img.src = url;
  });
}

export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function cropFace(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  box: FaceBox,
  out = 192,
  pad = 0.4
): string {
  const sw =
    (source as HTMLVideoElement).videoWidth ||
    (source as HTMLImageElement).naturalWidth ||
    source.width;
  const sh =
    (source as HTMLVideoElement).videoHeight ||
    (source as HTMLImageElement).naturalHeight ||
    source.height;
  let side = Math.max(box.width, box.height) * (1 + pad * 2);
  side = Math.min(side, sw, sh);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const sx = Math.max(0, Math.min(cx - side / 2, sw - side));
  const sy = Math.max(0, Math.min(cy - side / 2, sh - side));
  const c = document.createElement('canvas');
  c.width = c.height = out;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.drawImage(source, sx, sy, side, side, 0, 0, out, out);
  }
  return c.toDataURL('image/jpeg', 0.86);
}

export function initials(name = '?'): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() || '')
      .join('') || '?'
  );
}

export function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ============================================================================
// Face-API Recognition Engine, Gallery Matcher, Multi-Frame Tracker & LiveEngine
// ============================================================================
declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    faceapi?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    deferredInstallPrompt?: any;
  }
}

const POSSIBLE_BAND = 0.06;
const AMBIGUITY_MARGIN = 0.04;
const VOTE_WINDOW = 5;
const TRACK_TTL_MS = 1200;

const loadedModels: { core: Promise<void> | null; accurate: Promise<void> | null } = {
  core: null,
  accurate: null,
};

export function loadCoreModels(onProgress: (msg: string) => void = () => {}): Promise<void> {
  if (!loadedModels.core) {
    loadedModels.core = (async () => {
      const faceapi = window.faceapi;
      if (!faceapi) {
        throw new Error('face-api.js failed to load. Check your connection and reload.');
      }
      onProgress('Loading face detector…');
      await faceapi.nets.tinyFaceDetector.loadFromUri('/models');
      onProgress('Loading landmark model…');
      await faceapi.nets.faceLandmark68Net.loadFromUri('/models');
      onProgress('Loading recognition model…');
      await faceapi.nets.faceRecognitionNet.loadFromUri('/models');
      await faceapi.tf?.ready?.();
    })().catch((err) => {
      loadedModels.core = null;
      throw err;
    });
  }
  return loadedModels.core;
}

export function loadAccurateModel(onProgress: (msg: string) => void = () => {}): Promise<void> {
  if (!loadedModels.accurate) {
    loadedModels.accurate = (async () => {
      const faceapi = window.faceapi;
      if (!faceapi) {
        throw new Error('face-api.js failed to load.');
      }
      onProgress('Loading accurate detector…');
      await faceapi.nets.ssdMobilenetv1.loadFromUri('/models');
    })().catch((err) => {
      loadedModels.accurate = null;
      throw err;
    });
  }
  return loadedModels.accurate;
}

export interface DetectedFace {
  box: FaceBox;
  score: number;
  descriptor: Float32Array;
}

export async function detectFaces(
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  {
    accurate = false,
    inputSize,
    minConfidence,
    smallFaceBoost,
  }: {
    accurate?: boolean;
    inputSize?: number;
    minConfidence?: number;
    smallFaceBoost?: boolean;
  } = {}
): Promise<DetectedFace[]> {
  const s = getSettings();
  const useSSD = accurate || s.detector === 'ssd';
  const boost = smallFaceBoost ?? s.smallFaceBoost;
  await loadCoreModels();
  if (useSSD) await loadAccurateModel();

  const faceapi = window.faceapi;
  // If smallFaceBoost is on, automatically elevate detector resolution to 608+ and lower detection threshold to 0.20
  const effectiveInputSize = inputSize ?? (boost ? Math.max(608, s.inputSize) : s.inputSize);
  const effectiveScoreThreshold = boost ? 0.20 : 0.40;
  const effectiveMinConfidence = minConfidence ?? (boost ? 0.20 : 0.42);

  const opts = useSSD
    ? new faceapi.SsdMobilenetv1Options({ minConfidence: effectiveMinConfidence })
    : new faceapi.TinyFaceDetectorOptions({
        inputSize: effectiveInputSize,
        scoreThreshold: effectiveScoreThreshold,
      });

  const results = await faceapi
    .detectAllFaces(input, opts)
    .withFaceLandmarks()
    .withFaceDescriptors();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return results.map((r: any) => ({
    box: {
      x: r.detection.box.x,
      y: r.detection.box.y,
      width: r.detection.box.width,
      height: r.detection.box.height,
    },
    score: r.detection.score,
    descriptor: r.descriptor as Float32Array,
  }));
}

function euclideanDistance(a: Float32Array | number[], b: Float32Array | number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

export interface MatchIdentity {
  status: RecognitionStatus;
  person: { id: number; name: string; color: string } | null;
  distance: number | null;
  margin: number | null;
  key?: string;
}

export class Gallery {
  version: number;
  people: { id: number; name: string; color: string; descriptors: Float32Array[] }[];

  constructor(data?: TrillGalleryData) {
    this.version = data?.version || 0;
    this.people = (data?.people || [])
      .filter((p) => p.descriptors && p.descriptors.length)
      .map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        descriptors: p.descriptors.map((d) => Float32Array.from(d)),
      }));
  }

  get size(): number {
    return this.people.length;
  }

  match(desc: Float32Array, threshold: number): MatchIdentity {
    if (!this.people.length) {
      return { status: 'unknown', person: null, distance: null, margin: null };
    }

    let best: { person: { id: number; name: string; color: string }; distance: number } | null =
      null;
    let second: { person: { id: number; name: string; color: string }; distance: number } | null =
      null;

    for (const p of this.people) {
      let d = Infinity;
      for (const ref of p.descriptors) {
        const dd = euclideanDistance(desc, ref);
        if (dd < d) d = dd;
      }
      if (!best || d < best.distance) {
        second = best;
        best = { person: p, distance: d };
      } else if (!second || d < second.distance) {
        second = { person: p, distance: d };
      }
    }

    if (!best) {
      return { status: 'unknown', person: null, distance: null, margin: null };
    }

    const margin = second ? second.distance - best.distance : Infinity;
    let status: RecognitionStatus;
    if (best.distance <= threshold) {
      status = margin < AMBIGUITY_MARGIN ? 'possible' : 'match';
    } else if (best.distance <= threshold + POSSIBLE_BAND) {
      status = 'possible';
    } else {
      status = 'unknown';
    }

    return {
      status,
      person: status === 'unknown' ? null : best.person,
      distance: best.distance,
      margin,
    };
  }
}

function iou(a: FaceBox, b: FaceBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

function consensus(votes: MatchIdentity[]): MatchIdentity | null {
  const counts = new Map<string, number>();
  let winner: string | null = null;
  let winnerCount = 0;
  for (const v of votes) {
    const key = `${v.status}:${v.person ? v.person.id : '-'}`;
    const c = (counts.get(key) || 0) + 1;
    counts.set(key, c);
    if (c >= winnerCount) {
      winnerCount = c;
      winner = key;
    }
  }
  for (let i = votes.length - 1; i >= 0; i--) {
    const v = votes[i];
    const key = `${v.status}:${v.person ? v.person.id : '-'}`;
    if (key === winner) return { ...v, key };
  }
  return null;
}

let trackSeq = 1;

export class Track {
  id: number;
  box: FaceBox;
  target: FaceBox;
  lastSeen: number;
  descriptor: Float32Array;
  votes: MatchIdentity[];
  identity: MatchIdentity | null;
  logKey: string | null;

  constructor(det: DetectedFace, now: number) {
    this.id = trackSeq++;
    this.box = { ...det.box };
    this.target = { ...det.box };
    this.lastSeen = now;
    this.descriptor = det.descriptor;
    this.votes = [];
    this.identity = null;
    this.logKey = null;
  }

  update(det: DetectedFace, gallery: Gallery, threshold: number, now: number) {
    this.target = { ...det.box };
    this.lastSeen = now;
    this.descriptor = det.descriptor;
    this.votes.push(gallery.match(det.descriptor, threshold));
    if (this.votes.length > VOTE_WINDOW) this.votes.shift();
    this.identity = consensus(this.votes);
  }
}

export class Tracker {
  tracks: Track[] = [];

  update(dets: DetectedFace[], gallery: Gallery, threshold: number, now: number): Track[] {
    const pairs: { o: number; d: DetectedFace; t: Track }[] = [];
    for (const d of dets) {
      for (const t of this.tracks) {
        const o = iou(d.box, t.target);
        if (o > 0.3) pairs.push({ o, d, t });
      }
    }
    pairs.sort((a, b) => b.o - a.o);

    const usedDet = new Set<DetectedFace>();
    const usedTrack = new Set<Track>();
    for (const p of pairs) {
      if (usedDet.has(p.d) || usedTrack.has(p.t)) continue;
      usedDet.add(p.d);
      usedTrack.add(p.t);
      p.t.update(p.d, gallery, threshold, now);
    }
    for (const d of dets) {
      if (usedDet.has(d)) continue;
      const t = new Track(d, now);
      t.update(d, gallery, threshold, now);
      this.tracks.push(t);
    }
    this.tracks = this.tracks.filter((t) => now - t.lastSeen < TRACK_TTL_MS);
    return this.tracks;
  }
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawTracks(
  ctx: CanvasRenderingContext2D,
  items: { box: FaceBox; identity: MatchIdentity | null }[],
  {
    W,
    H,
    mirror = false,
    colorMode = 'person',
  }: { W: number; H: number; mirror?: boolean; colorMode?: 'status' | 'person' }
) {
  ctx.clearRect(0, 0, W, H);
  if (!W || !H) return;
  ctx.textBaseline = 'middle';

  for (const t of items) {
    const id = t.identity;
    if (!id) continue;
    const { status, person, distance } = id;
    const b = t.box;
    const x = mirror ? W - b.x - b.width : b.x;
    const y = b.y;
    const w = b.width;
    const h = b.height;
    const color =
      colorMode === 'person'
        ? getPersonColor(person, status)
        : STATUS_COLOR[status];

    // Adaptive stroke width & font size tailored per face size so small faces stay razor-sharp
    const faceLw = Math.max(1.8, Math.min(3.5, Math.round(w / 38)));
    const faceFs = Math.max(10, Math.min(18, Math.round(Math.max(w * 0.20, 10))));
    ctx.font = `600 ${faceFs}px "Plus Jakarta Sans", system-ui, -apple-system, sans-serif`;

    // 100% see-through interior with crisp vivid neon glowing borders (NO fill inside box)
    ctx.save();
    ctx.lineWidth = faceLw;
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 6;
    roundRectPath(ctx, x, y, w, h, Math.max(3, Math.min(8, w * 0.08)));
    ctx.stroke();

    // High-tech corner bracket reticles for crisp framing without obscuring the face
    const cLen = Math.min(w * 0.22, h * 0.22, 14);
    if (cLen > 4) {
      ctx.lineWidth = faceLw + 1;
    // Top-left
    ctx.beginPath();
    ctx.moveTo(x, y + cLen);
    ctx.lineTo(x, y);
    ctx.lineTo(x + cLen, y);
    ctx.stroke();
    // Top-right
    ctx.beginPath();
    ctx.moveTo(x + w - cLen, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + cLen);
    ctx.stroke();
    // Bottom-left
    ctx.beginPath();
    ctx.moveTo(x, y + h - cLen);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x + cLen, y + h);
    ctx.stroke();
    // Bottom-right
    ctx.beginPath();
    ctx.moveTo(x + w - cLen, y + h);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + w, y + h - cLen);
    ctx.stroke();
    }
    ctx.restore();

    const prefix = status === 'match' ? '✓ ' : status === 'possible' ? '? ' : '✕ ';
    const name = person ? person.name : 'Unknown';
    const text = `${prefix}${name}${distance != null ? `  ${distance.toFixed(2)}` : ''}`;
    const pad = faceFs * 0.4;
    const chipH = faceFs + pad * 1.5;
    const chipW = ctx.measureText(text).width + pad * 2.5;
    let cy = y - chipH - faceLw - 2;
    if (cy < 0) cy = y + h + faceLw + 2;
    const cx = Math.max(0, Math.min(x, W - chipW));
    ctx.fillStyle = color;
    roundRectPath(ctx, cx, cy, chipW, chipH, 4);
    ctx.fill();
    ctx.fillStyle = '#06101c';
    ctx.fillText(text, cx + pad * 1.25, cy + chipH / 2);
  }
}

export interface LiveStats {
  fps?: number;
  detMs?: number;
  faces?: number;
  error?: string;
}

export class LiveEngine {
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  onStats: (st: LiveStats) => void;
  onIdentity: (ev: {
    personId: number | null;
    label: string;
    status: RecognitionStatus;
    distance: number | null;
  }) => void;
  tracker: Tracker;
  gallery: Gallery;
  mirror = false;
  running = false;
  paused = false;
  fps = 0;
  detMs = 0;
  lastLog = new Map<string, number>();
  lastAutoSnap = new Map<number, number>();
  private _raf = 0;

  constructor({
    video,
    canvas,
    onStats = () => {},
    onIdentity = () => {},
  }: {
    video: HTMLVideoElement;
    canvas: HTMLCanvasElement;
    onStats?: (st: LiveStats) => void;
    onIdentity?: (ev: {
      personId: number | null;
      label: string;
      status: RecognitionStatus;
      distance: number | null;
    }) => void;
  }) {
    this.video = video;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.onStats = onStats;
    this.onIdentity = onIdentity;
    this.tracker = new Tracker();
    this.gallery = new Gallery({ version: 0, people: [] });
  }

  get tracks(): Track[] {
    return this.tracker.tracks;
  }

  setGallery(g: Gallery | TrillGalleryData) {
    this.gallery = g instanceof Gallery ? g : new Gallery(g);
  }

  setPaused(p: boolean) {
    this.paused = p;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._detectLoop();
    this._renderLoop();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
  }

  private _sizeCanvas() {
    const W = this.video.videoWidth;
    const H = this.video.videoHeight;
    if (W && (this.canvas.width !== W || this.canvas.height !== H)) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
  }

  private async _detectLoop() {
    let last = performance.now();
    while (this.running) {
      if (this.paused || this.video.readyState < 2 || !this.video.videoWidth) {
        await sleep(100);
        continue;
      }
      const t0 = performance.now();
      try {
        const s = getSettings();
        const dets = await detectFaces(this.video);
        const now = performance.now();
        this.detMs = now - t0;
        this.tracker.update(dets, this.gallery, s.threshold, now);
        this._emitIdentities();
        this.fps = 0.8 * this.fps + 0.2 * (1000 / Math.max(1, now - last));
        last = now;
        this.onStats({
          fps: this.fps,
          detMs: this.detMs,
          faces: this.tracker.tracks.length,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.onStats({ error: msg });
        await sleep(600);
      }
      await sleep(0);
    }
  }

  private _renderLoop() {
    const frame = () => {
      if (!this.running) return;
      this._sizeCanvas();
      const W = this.canvas.width;
      const H = this.canvas.height;
      const s = getSettings();

      // If TrueColor Night-to-Day is enabled, colorize monochrome IR into daylight before tracks!
      if (s.nightVisionMode === 'trueColor' && this.video.readyState >= 2) {
        trueColorNightVision.processFrame(this.video, this.ctx, W, H, {
          profileId: s.daylightProfile,
          detectedFaces: this.tracker.tracks.map((tr) => ({
            x: tr.box.x,
            y: tr.box.y,
            width: tr.box.width,
            height: tr.box.height,
            color: tr.identity?.person?.color,
          })),
        });
      }

      const k = 0.35;
      for (const t of this.tracker.tracks) {
        t.box.x += (t.target.x - t.box.x) * k;
        t.box.y += (t.target.y - t.box.y) * k;
        t.box.width += (t.target.width - t.box.width) * k;
        t.box.height += (t.target.height - t.box.height) * k;
      }

      drawTracks(this.ctx, this.tracker.tracks, {
        W,
        H,
        mirror: this.mirror,
        colorMode: s.boxColorMode,
      });
      this._raf = requestAnimationFrame(frame);
    };
    frame();
  }

  private _emitIdentities() {
    const now = Date.now();
    const s = getSettings();
    for (const t of this.tracker.tracks) {
      const id = t.identity;
      if (!id || !id.key || t.votes.length < 2 || t.logKey === id.key) continue;
      t.logKey = id.key;
      const last = this.lastLog.get(id.key) || 0;
      if (now - last < 25000) continue;
      this.lastLog.set(id.key, now);

      // 1. Voice Announcement: speak "[Name] was recognized" aloud if turned on
      if (id.status === 'match' && id.person && s.voiceAnnounce) {
        voiceAnnouncer.announceRecognition(id.person.name, {
          cooldownMs: (s.voiceAnnounceCooldownSec || 15) * 1000,
        });
      }

      // 2. High-Tech Sound Feedback
      if (s.soundEffects) {
        if (id.status === 'match') {
          playBiometricLockChime();
        } else if (id.status === 'unknown') {
          playIntruderAlertTone();
        }
      }

      // 3. Automated Auto-Snap of Unknown Face
      if (id.status === 'unknown' && s.autoSnapUnknown) {
        const lastSnap = this.lastAutoSnap.get(t.id) || 0;
        const cooldown = (s.autoSnapCooldownSec || 15) * 1000;
        if (now - lastSnap > cooldown && this.video.readyState >= 2) {
          this.lastAutoSnap.set(t.id, now);
          try {
            const snapImage = cropFace(this.video, t.target, 220);
            if (s.soundEffects) playCameraShutterSound();
            api
              .addIntruder({
                image: snapImage,
                descriptor: Array.from(t.descriptor),
                distance: id.distance,
                label: 'Unknown Subject',
                note: `Security DVR CAM-01 Auto-Snap · Track #${t.id}`,
              })
              .then((saved) => {
                window.dispatchEvent(
                  new CustomEvent('trill:auto-snap', {
                    detail: { id: saved.id, image: snapImage, trackId: t.id },
                  })
                );
              })
              .catch(() => {});
          } catch {
            // ignore snapshot error
          }
        }
      }

      this.onIdentity({
        personId: id.person ? id.person.id : null,
        label: id.person ? id.person.name : 'Unknown',
        status: id.status,
        distance: id.distance == null ? null : Number(id.distance.toFixed(4)),
      });
    }
  }
}

// ============================================================================
// Enrollment Helpers
// ============================================================================
export function addSample(
  personId: number,
  {
    descriptor,
    image,
    source = 'camera',
  }: { descriptor: Float32Array | number[]; image?: string; source?: string }
) {
  return api.addFace(personId, {
    descriptor: Array.from(descriptor),
    image,
    source,
  });
}

export async function enrollFromSource(
  source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
  personId: number,
  { accurate = true } = {}
): Promise<{ ok: boolean; faces?: number; reason?: string }> {
  const dets = await detectFaces(source, { accurate });
  if (!dets.length) return { ok: false, reason: 'No face found' };
  dets.sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height);
  const d = dets[0];
  await addSample(personId, {
    descriptor: d.descriptor,
    image: cropFace(source, d.box),
    source: 'upload',
  });
  return { ok: true, faces: dets.length };
}

export async function resolvePerson(selectValue: string, newName: string): Promise<number> {
  if (selectValue !== '__new') return Number(selectValue);
  const name = (newName || '').trim();
  if (!name) throw new Error('Enter a name');
  try {
    const p = await api.createPerson({ name });
    return p.id;
  } catch (e) {
    const err = e as ApiError;
    if (err.status !== 409) throw e;
    const existing = (await api.people()).find(
      (p) => p.name.toLowerCase() === name.toLowerCase()
    );
    if (!existing) throw e;
    return existing.id;
  }
}
