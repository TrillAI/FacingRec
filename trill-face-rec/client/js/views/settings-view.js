// Settings: recognition tuning, camera, display, server connection, offline and install options.
import { h, icon, toast } from '../util.js';
import { getSettings, setSettings } from '../settings.js';
import { api } from '../api.js';
import { getGallery } from '../gallery.js';
import { kvSet } from '../store.js';
import { pendingCount } from '../events.js';

const MODEL_FILES = [
  'tiny_face_detector_model-weights_manifest.json', 'tiny_face_detector_model.bin',
  'face_landmark_68_model-weights_manifest.json', 'face_landmark_68_model.bin',
  'face_recognition_model-weights_manifest.json', 'face_recognition_model.bin',
  'ssd_mobilenetv1_model-weights_manifest.json', 'ssd_mobilenetv1_model.bin',
];

export async function render(root) {
  const s = getSettings();
  const out = [];

  // --- recognition ---
  const threshold = h('input', { type: 'range', min: '0.30', max: '0.70', step: '0.01', value: String(s.threshold) });
  const thresholdVal = h('span', { class: 'mono' }, s.threshold.toFixed(2));
  threshold.addEventListener('input', () => {
    thresholdVal.textContent = Number(threshold.value).toFixed(2);
    setSettings({ threshold: Number(threshold.value) });
  });

  const detector = radioGroup('detector', [
    { value: 'tiny', label: 'Fast (default)' },
    { value: 'ssd', label: 'Accurate' },
  ], s.detector, (v) => setSettings({ detector: v }));

  const inputSize = radioGroup('inputSize', [
    { value: '224', label: 'Fast' },
    { value: '320', label: 'Balanced' },
    { value: '416', label: 'Far faces' },
  ], String(s.inputSize), (v) => setSettings({ inputSize: Number(v) }));

  out.push(section('Recognition', [
    field('Match threshold', 'Lower is stricter (fewer false matches). Higher finds more matches but risks mistakes. 0.50 is a good start.',
      h('div', { class: 'row' }, threshold, thresholdVal)),
    field('Detector', 'Accurate uses an SSD MobileNet model: better on small or angled faces, slower to load (~5 MB).', detector),
    field('Resolution', 'Higher resolution finds smaller faces but costs speed.', inputSize),
  ]));

  // --- camera & display ---
  const facing = h('select', { class: 'input' },
    h('option', { value: 'user', selected: s.facing === 'user' ? true : null }, 'Front camera'),
    h('option', { value: 'environment', selected: s.facing === 'environment' ? true : null }, 'Back camera'));
  facing.addEventListener('change', () => setSettings({ facing: facing.value }));

  out.push(section('Camera & display', [
    field('Default camera', 'Used when the Live view starts.', facing),
    toggle('Mirror front camera', 'Flip the front camera like a mirror.', s.mirror, (v) => setSettings({ mirror: v })),
    field('Box colors', 'Status colors: green, amber, red. Person colors: each person gets their own color.',
      radioGroup('boxColorMode', [{ value: 'status', label: 'Status' }, { value: 'person', label: 'Person' }],
        s.boxColorMode, (v) => setSettings({ boxColorMode: v }))),
    toggle('Show performance HUD', 'FPS, detection time and face count over the camera feed.', s.showFps, (v) => setSettings({ showFps: v })),
    toggle('Log recognitions', 'Record recognized and unknown faces to the server log.', s.logEvents, (v) => setSettings({ logEvents: v })),
  ]));

  // --- server ---
  const keyInput = h('input', { class: 'input', type: 'password', value: s.apiKey, placeholder: 'Only if the server requires one', autocomplete: 'off' });
  const serverStatus = h('span', { class: 'pill' }, 'Checking…');
  const testBtn = h('button', { class: 'btn', onclick: testConnection }, 'Test connection');
  const saveKey = h('button', { class: 'btn primary', onclick: () => { setSettings({ apiKey: keyInput.value.trim() }); toast('API key saved', 'success'); testConnection(); } }, 'Save key');

  out.push(section('Server', [
    field('Connection', 'People, samples and the log are stored on the Trill server.',
      h('div', { class: 'row' }, serverStatus, testBtn)),
    field('API key', 'Set this if the server was started with TRILL_API_KEY.',
      h('div', { class: 'row grow-row' }, keyInput, saveKey)),
  ]));

  // --- offline ---
  const galleryInfo = h('span', { class: 'muted small' }, '');
  const downloadBtn = h('button', { class: 'btn', onclick: downloadModels }, 'Download models for offline use');
  const syncBtn = h('button', { class: 'btn', onclick: async () => { await getGallery({ refresh: true }); toast('Gallery synced', 'success'); updateGalleryInfo(); } }, 'Sync gallery now');
  const clearBtn = h('button', { class: 'btn danger', onclick: async () => { await kvSet('gallery', null); toast('Offline cache cleared'); updateGalleryInfo(); } }, 'Clear offline cache');

  out.push(section('Offline', [
    field('Gallery cache', 'Recognition keeps working without a connection using the last synced gallery.',
      h('div', { class: 'stack' }, galleryInfo, h('div', { class: 'row' }, syncBtn, clearBtn))),
    field('Models', 'Models are cached automatically on first use. Download them now to be sure they are ready offline.',
      h('div', { class: 'row' }, downloadBtn, h('span', { class: 'muted small', id: 'dl-progress' }))),
  ]));

  // --- install & about ---
  const installBtn = h('button', { class: 'btn primary', onclick: install }, icon('plus'), ' Install app');
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const storageEl = h('span', { class: 'muted small' }, '');
  navigator.storage?.estimate?.().then((e) => {
    if (e?.usage) storageEl.textContent = `${(e.usage / 1048576).toFixed(1)} MB used by this app`;
  });

  out.push(section('App', [
    field('Install', standalone
      ? 'Running as an installed app.'
      : 'Install Trill Face Rec to your home screen or desktop for a full-screen app experience. On iPhone: Share → Add to Home Screen.',
      standalone ? h('span', { class: 'pill on' }, 'Installed') : installBtn),
    field('About', 'Trill Face Rec 1.0. Face embeddings are computed on-device with face-api.js (TensorFlow.js).',
      h('div', { class: 'stack' }, storageEl)),
  ]));

  root.append(
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Settings'), h('p', { class: 'muted small' }, 'Changes save automatically.'))),
    ...out);

  async function testConnection() {
    serverStatus.className = 'pill';
    serverStatus.textContent = 'Checking…';
    try {
      const hl = await api.health();
      serverStatus.className = 'pill on';
      serverStatus.textContent = hl.authRequired && !getSettings().apiKey ? 'Connected · key needed' : 'Connected';
    } catch (e) {
      serverStatus.className = 'pill off';
      serverStatus.textContent = e.status === 401 ? 'API key rejected' : 'Unreachable';
    }
  }

  async function updateGalleryInfo() {
    const g = await getGallery();
    const samples = g.people.reduce((n, p) => n + p.descriptors.length, 0);
    const pending = await pendingCount();
    galleryInfo.textContent = `${g.people.length} people · ${samples} samples · ${pending} queued event${pending === 1 ? '' : 's'}`;
  }

  async function downloadModels() {
    const prog = root.querySelector('#dl-progress');
    let done = 0;
    downloadBtn.disabled = true;
    for (const f of MODEL_FILES) {
      try {
        await fetch(`models/${f}`, { cache: 'reload' });
      } catch { /* offline: ignore */ }
      done++;
      prog.textContent = `${done}/${MODEL_FILES.length}`;
    }
    prog.textContent = 'Done';
    downloadBtn.disabled = false;
    toast('Models cached for offline use', 'success');
  }

  let deferred = window.deferredInstallPrompt;
  window.addEventListener('beforeinstallprompt', (e) => { deferred = e; window.deferredInstallPrompt = e; });
  async function install() {
    if (!deferred) return toast('Use your browser menu → Install app / Add to Home Screen', 'info', 5000);
    deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    window.deferredInstallPrompt = null;
  }

  testConnection();
  updateGalleryInfo();
}

function section(title, children) {
  return h('section', { class: 'card settings-section' }, h('h2', {}, title), ...children);
}

function field(label, hint, control) {
  return h('div', { class: 'field-row' },
    h('div', { class: 'field-label' }, h('strong', {}, label), h('p', { class: 'muted small' }, hint)),
    h('div', { class: 'field-control' }, control));
}

function toggle(label, hint, value, onChange) {
  const input = h('input', { type: 'checkbox', class: 'switch', checked: value ? true : null, 'aria-label': label });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'toggle-row' },
    h('div', {}, h('strong', {}, label), h('p', { class: 'muted small' }, hint)), input);
}

function radioGroup(name, options, value, onChange) {
  const wrap = h('div', { class: 'seg' });
  const paint = () => wrap.replaceChildren(...options.map((o) => h('button', {
    class: o.value === value ? 'on' : '',
    role: 'radio',
    'aria-checked': String(o.value === value),
    onclick: () => { value = o.value; onChange(o.value); paint(); },
  }, o.label)));
  paint();
  return wrap;
}
