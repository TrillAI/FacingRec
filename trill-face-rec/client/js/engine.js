// Recognition engine: model loading, face detection + embedding, gallery matching,
// per-face tracking with vote smoothing, and overlay drawing.
import { getSettings } from './settings.js';
import { sleep } from './util.js';

export const STATUS_COLOR = { match: '#22c55e', possible: '#f59e0b', unknown: '#ef4444' };
export const STATUS_LABEL = { match: 'Recognized', possible: 'Possible match', unknown: 'Unknown' };

// Tolerance band above the threshold where a face is shown as "possible" instead of "unknown".
const POSSIBLE_BAND = 0.06;
// If the second-best person is this close to the best, the result is ambiguous.
const AMBIGUITY_MARGIN = 0.04;
// Number of recent frames used for vote smoothing (kills flicker, improves accuracy).
const VOTE_WINDOW = 5;
// A track that has not been detected for this long is dropped.
const TRACK_TTL_MS = 1200;

const loaded = { core: null, accurate: null };

// ---- model loading --------------------------------------------------------
export function loadCoreModels(onProgress = () => {}) {
  if (!loaded.core) {
    loaded.core = (async () => {
      if (!window.faceapi) throw new Error('face-api.js failed to load. Check your connection and reload.');
      onProgress('Loading face detector…');
      await faceapi.nets.tinyFaceDetector.loadFromUri('models');
      onProgress('Loading landmark model…');
      await faceapi.nets.faceLandmark68Net.loadFromUri('models');
      onProgress('Loading recognition model…');
      await faceapi.nets.faceRecognitionNet.loadFromUri('models');
      await faceapi.tf?.ready?.();
    })().catch((err) => { loaded.core = null; throw err; });
  }
  return loaded.core;
}

// SSD MobileNet is noticeably more accurate on small or angled faces, but heavier (~5 MB).
export function loadAccurateModel(onProgress = () => {}) {
  if (!loaded.accurate) {
    loaded.accurate = (async () => {
      onProgress('Loading accurate detector…');
      await faceapi.nets.ssdMobilenetv1.loadFromUri('models');
    })().catch((err) => { loaded.accurate = null; throw err; });
  }
  return loaded.accurate;
}

// ---- detection --------------------------------------------------------------
// input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
// Returns [{ box:{x,y,width,height}, score, descriptor: Float32Array(128) }] in input pixel space.
export async function detectFaces(input, { accurate = false, inputSize, minConfidence } = {}) {
  const s = getSettings();
  const useSSD = accurate || s.detector === 'ssd';
  await loadCoreModels();
  if (useSSD) await loadAccurateModel();

  const opts = useSSD
    ? new faceapi.SsdMobilenetv1Options({ minConfidence: minConfidence ?? 0.45 })
    : new faceapi.TinyFaceDetectorOptions({ inputSize: inputSize ?? s.inputSize, scoreThreshold: 0.45 });

  const results = await faceapi.detectAllFaces(input, opts).withFaceLandmarks().withFaceDescriptors();
  return results.map((r) => ({
    box: { x: r.detection.box.x, y: r.detection.box.y, width: r.detection.box.width, height: r.detection.box.height },
    score: r.detection.score,
    descriptor: r.descriptor,
  }));
}

// ---- matching ---------------------------------------------------------------
function distance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

export class Gallery {
  constructor(data) {
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

  get size() {
    return this.people.length;
  }

  // Returns { status: 'match'|'possible'|'unknown', person, distance, margin }
  match(desc, threshold) {
    if (!this.people.length) return { status: 'unknown', person: null, distance: null, margin: null };

    let best = null;
    let second = null;
    for (const p of this.people) {
      // Each person may have several reference photos; use the closest one.
      let d = Infinity;
      for (const ref of p.descriptors) {
        const dd = distance(desc, ref);
        if (dd < d) d = dd;
      }
      if (!best || d < best.distance) {
        second = best;
        best = { person: p, distance: d };
      } else if (!second || d < second.distance) {
        second = { person: p, distance: d };
      }
    }

    const margin = second ? second.distance - best.distance : Infinity;
    let status;
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

// ---- tracking ---------------------------------------------------------------
function iou(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

// Majority vote over recent frames; returns the latest vote that carries the winning key.
function consensus(votes) {
  const counts = new Map();
  let winner = null;
  let winnerCount = 0;
  for (const v of votes) {
    const key = `${v.status}:${v.person ? v.person.id : '-'}`;
    const c = (counts.get(key) || 0) + 1;
    counts.set(key, c);
    if (c >= winnerCount) { winnerCount = c; winner = key; }
  }
  for (let i = votes.length - 1; i >= 0; i--) {
    const v = votes[i];
    const key = `${v.status}:${v.person ? v.person.id : '-'}`;
    if (key === winner) return { ...v, key };
  }
  return null;
}

let trackSeq = 1;

class Track {
  constructor(det, now) {
    this.id = trackSeq++;
    this.box = { ...det.box };    // displayed (interpolated) box
    this.target = { ...det.box }; // latest detected box
    this.lastSeen = now;
    this.descriptor = det.descriptor;
    this.votes = [];
    this.identity = null;
    this.logKey = null;
  }

  update(det, gallery, threshold, now) {
    this.target = { ...det.box };
    this.lastSeen = now;
    this.descriptor = det.descriptor;
    this.votes.push(gallery.match(det.descriptor, threshold));
    if (this.votes.length > VOTE_WINDOW) this.votes.shift();
    this.identity = consensus(this.votes);
  }
}

export class Tracker {
  constructor() {
    this.tracks = [];
  }

  update(dets, gallery, threshold, now) {
    const pairs = [];
    for (const d of dets) {
      for (const t of this.tracks) {
        const o = iou(d.box, t.target);
        if (o > 0.3) pairs.push({ o, d, t });
      }
    }
    pairs.sort((a, b) => b.o - a.o);

    const usedDet = new Set();
    const usedTrack = new Set();
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

// ---- drawing ----------------------------------------------------------------
function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// items: [{ box, identity: {status, person, distance} }]
export function drawTracks(ctx, items, { W, H, mirror = false, colorMode = 'status' }) {
  ctx.clearRect(0, 0, W, H);
  if (!W || !H) return;
  const lw = Math.max(2, Math.round(W / 220));
  const fs = Math.max(13, Math.round(W / 40));
  ctx.font = `600 ${fs}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
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
    const color = colorMode === 'person' && person ? person.color : STATUS_COLOR[status];

    // box with translucent fill
    ctx.lineWidth = lw;
    ctx.strokeStyle = color;
    ctx.fillStyle = `${color}26`;
    roundRectPath(ctx, x, y, w, h, Math.max(6, w * 0.08));
    ctx.fill();
    ctx.stroke();

    // label chip
    const prefix = status === 'match' ? '✓ ' : status === 'possible' ? '? ' : '✕ ';
    const name = person ? person.name : 'Unknown';
    const text = `${prefix}${name}${distance != null ? `  ${distance.toFixed(2)}` : ''}`;
    const pad = fs * 0.5;
    const chipH = fs + pad;
    const chipW = ctx.measureText(text).width + pad * 2;
    let cy = y - chipH - lw;
    if (cy < 0) cy = y + h + lw; // no room above: place below the box
    const cx = Math.max(0, Math.min(x, W - chipW)); // keep the chip inside the frame
    ctx.fillStyle = color;
    roundRectPath(ctx, cx, cy, chipW, chipH, 6);
    ctx.fill();
    ctx.fillStyle = '#06101c';
    ctx.fillText(text, cx + pad, cy + chipH / 2);
  }
}

// ---- live loop ----------------------------------------------------------------
// Runs detection continuously in the background and renders at display rate with
// interpolated boxes, so the overlay stays smooth even when inference takes ~100-200 ms.
export class LiveEngine {
  constructor({ video, canvas, onStats = () => {}, onIdentity = () => {} }) {
    this.video = video;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onStats = onStats;
    this.onIdentity = onIdentity;
    this.tracker = new Tracker();
    this.gallery = new Gallery({ people: [] });
    this.mirror = false;
    this.running = false;
    this.paused = false;
    this.fps = 0;
    this.detMs = 0;
    this.lastLog = new Map();
    this._raf = 0;
  }

  get tracks() {
    return this.tracker.tracks;
  }

  setGallery(g) {
    this.gallery = g instanceof Gallery ? g : new Gallery(g);
  }

  setPaused(p) {
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

  _sizeCanvas() {
    const W = this.video.videoWidth;
    const H = this.video.videoHeight;
    if (W && (this.canvas.width !== W || this.canvas.height !== H)) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
  }

  async _detectLoop() {
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
        this.onStats({ fps: this.fps, detMs: this.detMs, faces: this.tracker.tracks.length });
      } catch (err) {
        console.error(err);
        this.onStats({ error: err.message || String(err) });
        await sleep(600);
      }
      await sleep(0); // yield to the UI thread between frames
    }
  }

  _renderLoop() {
    const frame = () => {
      if (!this.running) return;
      this._sizeCanvas();
      const W = this.canvas.width;
      const H = this.canvas.height;
      const k = 0.35;
      for (const t of this.tracker.tracks) {
        t.box.x += (t.target.x - t.box.x) * k;
        t.box.y += (t.target.y - t.box.y) * k;
        t.box.width += (t.target.width - t.box.width) * k;
        t.box.height += (t.target.height - t.box.height) * k;
      }
      drawTracks(this.ctx, this.tracker.tracks, {
        W, H, mirror: this.mirror, colorMode: getSettings().boxColorMode,
      });
      this._raf = requestAnimationFrame(frame);
    };
    frame();
  }

  // Emit a recognition event once per stable identity, throttled per identity.
  _emitIdentities() {
    const now = Date.now();
    for (const t of this.tracker.tracks) {
      const id = t.identity;
      if (!id || t.votes.length < 2 || t.logKey === id.key) continue;
      t.logKey = id.key;
      const last = this.lastLog.get(id.key) || 0;
      if (now - last < 30000) continue;
      this.lastLog.set(id.key, now);
      this.onIdentity({
        personId: id.person ? id.person.id : null,
        label: id.person ? id.person.name : 'Unknown',
        status: id.status,
        distance: id.distance == null ? null : Number(id.distance.toFixed(4)),
      });
    }
  }
}
