// Live recognition: camera feed with tracked, color-coded face boxes.
import { h, icon, toast, cropFace } from '../util.js';
import { getSettings, setSettings } from '../settings.js';
import { LiveEngine, loadCoreModels, STATUS_COLOR } from '../engine.js';
import { startCamera, stopCamera } from '../camera.js';
import { getGallery } from '../gallery.js';
import { logRecognition } from '../events.js';
import { openEnrollDialog } from '../enroll.js';

export async function render(root) {
  const s = getSettings();
  let facing = s.facing;

  const video = h('video', { autoplay: true, playsinline: true, muted: true });
  const canvas = h('canvas', { class: 'overlay', 'aria-label': 'Live face overlay. Tap a face to enroll it.' });
  const loader = h('div', { class: 'loader' }, h('div', { class: 'spinner' }), h('p', { class: 'loader-text' }, 'Starting…'));
  const hud = h('div', { class: 'hud', hidden: !s.showFps }, 'Starting…');
  const hint = h('div', { class: 'hint' }, 'Tap a face to enroll');
  const stage = h('div', { class: 'stage live-stage' }, video, canvas, hud, hint, loader);

  const pauseBtn = h('button', { class: 'btn', onclick: togglePause }, icon('pause'), ' Pause');
  const flipBtn = h('button', { class: 'btn', onclick: flip }, icon('flip'), ' Flip');
  const snapBtn = h('button', { class: 'btn', onclick: snapshot }, icon('camera'), ' Snapshot');

  const legend = h('div', { class: 'legend' },
    h('span', {}, h('i', { style: { background: STATUS_COLOR.match } }), 'Recognized'),
    h('span', {}, h('i', { style: { background: STATUS_COLOR.possible } }), 'Possible'),
    h('span', {}, h('i', { style: { background: STATUS_COLOR.unknown } }), 'Unknown'),
    h('span', { class: 'muted' }, `Threshold ${s.threshold.toFixed(2)} · ${s.detector === 'ssd' ? 'Accurate' : 'Fast'} mode`));

  root.append(
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Live recognition'), h('p', { class: 'muted small' }, 'Boxes update in real time. Models run on this device.')),
    ),
    stage,
    h('div', { class: 'row controls' }, pauseBtn, flipBtn, snapBtn),
    h('div', { class: 'card' }, legend),
  );

  const engine = new LiveEngine({
    video,
    canvas,
    onStats: (st) => {
      if (st.error) {
        hud.textContent = `Error: ${st.error}`;
        return;
      }
      if (getSettings().showFps) {
        hud.textContent = `${st.fps.toFixed(1)} fps · ${Math.round(st.detMs)} ms · ${st.faces} face${st.faces === 1 ? '' : 's'}`;
      }
    },
    onIdentity: (ev) => logRecognition(ev),
  });

  function applyMirror() {
    engine.mirror = getSettings().mirror && facing === 'user';
    video.classList.toggle('mirror', engine.mirror);
  }

  function videoPoint(e) {
    const rect = canvas.getBoundingClientRect();
    const W = video.videoWidth;
    const H = video.videoHeight;
    const scale = Math.max(rect.width / W, rect.height / H); // object-fit: cover
    const offX = (rect.width - W * scale) / 2;
    const offY = (rect.height - H * scale) / 2;
    let x = (e.clientX - rect.left - offX) / scale;
    const y = (e.clientY - rect.top - offY) / scale;
    if (engine.mirror) x = W - x;
    return { x, y };
  }

  canvas.addEventListener('click', (e) => {
    if (!engine.tracks.length) return;
    const p = videoPoint(e);
    const hits = engine.tracks
      .filter((t) => {
        const b = t.target;
        return p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
      })
      .sort((a, b) => (b.target.width * b.target.height) - (a.target.width * a.target.height));
    const hit = hits[0];
    if (!hit || !hit.descriptor) return;
    const descriptor = Float32Array.from(hit.descriptor);
    const image = cropFace(video, hit.target);
    const defaultPersonId = hit.identity?.person?.id ?? null;
    openEnrollDialog({ descriptor, image, source: 'camera', defaultPersonId });
  });

  async function togglePause() {
    engine.setPaused(!engine.paused);
    pauseBtn.replaceChildren(icon(engine.paused ? 'play' : 'pause'), engine.paused ? ' Resume' : ' Pause');
    hud.textContent = engine.paused ? 'Paused' : 'Resuming…';
  }

  async function flip() {
    facing = facing === 'user' ? 'environment' : 'user';
    setSettings({ facing });
    flipBtn.disabled = true;
    try {
      await startCamera(video, facing);
      applyMirror();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      flipBtn.disabled = false;
    }
  }

  function snapshot() {
    const W = video.videoWidth;
    const H = video.videoHeight;
    if (!W) return toast('Camera not ready yet', 'error');
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    if (engine.mirror) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    ctx.drawImage(video, 0, 0, W, H);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(canvas, 0, 0, W, H); // overlay is already in display orientation
    c.toBlob((blob) => {
      if (!blob) return toast('Snapshot failed', 'error');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `trill-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('Snapshot saved', 'success');
    }, 'image/jpeg', 0.92);
  }

  let gallery = null;
  const onGalleryChanged = async () => {
    gallery = await getGallery({ refresh: true });
    engine.setGallery(gallery);
  };
  window.addEventListener('trill:gallery-changed', onGalleryChanged);

  const onSettings = () => { applyMirror(); legendUpdate(); };
  window.addEventListener('trill:settings', onSettings);

  function legendUpdate() {
    const cur = getSettings();
    legend.lastChild.textContent = `Threshold ${cur.threshold.toFixed(2)} · ${cur.detector === 'ssd' ? 'Accurate' : 'Fast'} mode`;
  }

  let cancelled = false;
  (async () => {
    try {
      await loadCoreModels((msg) => { loader.querySelector('.loader-text').textContent = msg; });
      if (cancelled) return;
      loader.querySelector('.loader-text').textContent = 'Starting camera…';
      await startCamera(video, facing);
      if (cancelled) return;
      applyMirror();
      gallery = await getGallery();
      engine.setGallery(gallery);
      loader.remove();
      engine.start();
    } catch (e) {
      loader.replaceChildren(h('div', { class: 'loader-error' }, h('strong', {}, 'Could not start'), h('p', {}, e.message)));
    }
  })();

  return () => {
    cancelled = true;
    engine.stop();
    stopCamera(video);
    window.removeEventListener('trill:gallery-changed', onGalleryChanged);
    window.removeEventListener('trill:settings', onSettings);
  };
}
