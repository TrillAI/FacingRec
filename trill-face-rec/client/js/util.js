// Small DOM and utility helpers. Everything user-supplied goes through text nodes (no innerHTML),
// so names or notes can never inject markup.
export const $ = (sel, root = document) => root.querySelector(sel);

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const ICONS = {
  live: '<path d="M4 7h3l2-3h6l2 3h3v12H4z"/><circle cx="12" cy="13" r="3.5"/>',
  upload: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-8 8"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.3 3.3-5 6.5-5s5.7 1.7 6.5 5"/><path d="M16 4.5a3.5 3.5 0 010 7M18.5 15c1.5.6 2.6 2.2 3 5"/>',
  log: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
};

export function icon(name, cls = '') {
  const t = document.createElement('template');
  t.innerHTML = `<svg viewBox="0 0 24 24" class="ico ${cls}" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  return t.content.firstElementChild;
}

export function toast(msg, kind = 'info', ms = 3200) {
  const el = h('div', { class: `toast ${kind}`, role: 'status' }, msg);
  $('#toasts').append(el);
  setTimeout(() => el.classList.add('out'), ms);
  setTimeout(() => el.remove(), ms + 450);
}

// Generic modal. actions: [{label, primary, danger, onClick}]; onClick returning false keeps it open.
export function openModal({ title, body, actions = [], onClose }) {
  const root = $('#modal-root');
  let closed = false;
  let wrap = null;
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    wrap?.remove();
    onClose?.();
  };
  const run = async (a) => {
    try {
      const r = a.onClick ? await a.onClick() : undefined;
      if (r !== false) close();
    } catch (e) {
      toast(e.message || 'Something went wrong', 'error');
    }
  };
  const btns = actions.map((a) => h('button', {
    class: `btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''}`,
    onclick: () => run(a),
  }, a.label));
  wrap = h('div', { class: 'modal-backdrop', onclick: (e) => { if (e.target === wrap) close(); } },
    h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('header', {}, h('h2', {}, title),
        h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, '×')),
      h('div', { class: 'modal-body' }, body),
      btns.length ? h('footer', { class: 'modal-actions' }, btns) : null));
  root.append(wrap);
  document.addEventListener('keydown', onKey);
  return { close, el: wrap };
}

export function confirmDialog(message, { title = 'Are you sure?', okLabel = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    openModal({
      title,
      body: h('p', {}, message),
      actions: [
        { label: 'Cancel', onClick: () => resolve(false) },
        { label: okLabel, primary: !danger, danger, onClick: () => resolve(true) },
      ],
      onClose: () => resolve(false),
    });
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function fmtDate(ts) {
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function initials(name = '?') {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
}

export const PERSON_COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#eab308', '#22c55e', '#06b6d4'];

export function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')); };
    img.src = url;
  });
}

// Crop a square region around a detected box (box in source pixel coordinates) to a JPEG data URL.
export function cropFace(source, box, out = 192, pad = 0.4) {
  const sw = source.videoWidth || source.naturalWidth || source.width;
  const sh = source.videoHeight || source.naturalHeight || source.height;
  let side = Math.max(box.width, box.height) * (1 + pad * 2);
  side = Math.min(side, sw, sh);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const sx = Math.max(0, Math.min(cx - side / 2, sw - side));
  const sy = Math.max(0, Math.min(cy - side / 2, sh - side));
  const c = document.createElement('canvas');
  c.width = c.height = out;
  c.getContext('2d').drawImage(source, sx, sy, side, side, 0, 0, out, out);
  return c.toDataURL('image/jpeg', 0.86);
}
