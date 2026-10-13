// Analyze a photo: detect every face, identify it against the gallery, and enroll from it.
import { h, icon, toast, loadImage, cropFace } from '../util.js';
import { getSettings } from '../settings.js';
import { detectFaces, drawTracks, Gallery, STATUS_LABEL, loadAccurateModel } from '../engine.js';
import { getGallery } from '../gallery.js';
import { openEnrollDialog } from '../enroll.js';

export async function render(root) {
  let objectUrl = null;

  const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
  const cameraInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true });
  const pick = h('button', { class: 'btn primary', onclick: () => fileInput.click() }, icon('upload'), ' Choose photo');
  const snap = h('button', { class: 'btn', onclick: () => cameraInput.click() }, icon('camera'), ' Take photo');

  const dropzone = h('div', { class: 'drop' },
    h('strong', {}, 'Drop a photo here'),
    h('span', { class: 'muted small' }, 'JPEG, PNG or WebP. Processing happens on this device.'),
    h('div', { class: 'row' }, pick, snap));

  const stageWrap = h('div', { class: 'imgstage', hidden: true });
  const summary = h('p', { class: 'muted small', 'aria-live': 'polite' });
  const results = h('div', { class: 'stack face-results' });

  root.append(
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Analyze photo'),
      h('p', { class: 'muted small' }, 'Uses the accurate detector to find every face in a still image.'))),
    dropzone, fileInput, cameraInput, stageWrap, summary, results);

  fileInput.addEventListener('change', () => handle(fileInput.files[0]));
  cameraInput.addEventListener('change', () => handle(cameraInput.files[0]));
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('over'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('over'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('over');
    handle(e.dataTransfer.files[0]);
  });

  async function handle(file) {
    fileInput.value = '';
    cameraInput.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast('Please choose an image file', 'error');
    results.replaceChildren();
    summary.textContent = 'Loading image…';
    let loaded;
    try {
      loaded = await loadImage(file);
    } catch (e) {
      return toast(e.message, 'error');
    }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = loaded.url;
    const img = loaded.img;

    stageWrap.hidden = false;
    stageWrap.replaceChildren();
    const canvas = h('canvas', { width: img.naturalWidth, height: img.naturalHeight });
    stageWrap.append(h('img', { src: objectUrl, alt: 'Selected photo' }), canvas);

    try {
      summary.textContent = 'Loading accurate detector (first run only)…';
      await loadAccurateModel();
      summary.textContent = 'Detecting and identifying faces…';
      const [dets, gallery] = await Promise.all([detectFaces(img, { accurate: true }), getGallery()]);
      const matcher = new Gallery(gallery);
      const threshold = getSettings().threshold;

      const items = dets.map((d) => ({ box: d.box, identity: matcher.match(d.descriptor, threshold), descriptor: d.descriptor }));
      drawTracks(canvas.getContext('2d'), items, {
        W: canvas.width, H: canvas.height, mirror: false, colorMode: getSettings().boxColorMode,
      });

      summary.textContent = dets.length
        ? `${dets.length} face${dets.length === 1 ? '' : 's'} found.`
        : 'No faces found. Try a clearer or closer photo.';

      items.forEach((it, i) => results.append(faceCard(img, it, i)));
    } catch (e) {
      summary.textContent = '';
      toast(e.message || 'Analysis failed', 'error');
    }
  }

  function faceCard(img, it, i) {
    const { identity: id, box } = it;
    const thumb = cropFace(img, box, 160);
    const label = id.person ? id.person.name : 'Unknown';
    return h('div', { class: 'card face-card' },
      h('img', { class: 'face-thumb', src: thumb, alt: `Face ${i + 1}` }),
      h('div', { class: 'face-meta' },
        h('strong', {}, label),
        h('div', { class: 'row' },
          h('span', { class: `badge ${id.status}` }, STATUS_LABEL[id.status]),
          id.distance != null ? h('span', { class: 'muted small' }, `distance ${id.distance.toFixed(2)}`) : null)),
      h('button', {
        class: 'btn',
        onclick: () => openEnrollDialog({
          descriptor: Float32Array.from(it.descriptor),
          image: thumb,
          source: 'upload',
          defaultPersonId: id.person ? id.person.id : null,
        }),
      }, 'Enroll…'));
  }

  return () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  };
}

