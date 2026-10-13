// People management: list, add, edit, delete people; manage each person's enrolled face samples.
import { h, icon, toast, openModal, confirmDialog, initials, PERSON_COLORS, loadImage, fmtDate, cropFace } from '../util.js';
import { api } from '../api.js';
import { startCamera, stopCamera } from '../camera.js';
import { getSettings } from '../settings.js';
import { loadCoreModels, detectFaces } from '../engine.js';
import { addSample, enrollFromSource } from '../enroll.js';
import { notifyGalleryChanged } from '../gallery.js';

export async function render(root, params = []) {
  if (params[0]) return renderPerson(root, params[0]);
  return renderList(root);
}

// ---------- list ----------
async function renderList(root) {
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search people…', 'aria-label': 'Search people' });
  const list = h('div', { class: 'people-grid' }, h('p', { class: 'muted' }, 'Loading…'));
  const count = h('span', { class: 'muted small' });
  root.append(
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'People'), count),
      h('button', { class: 'btn primary', onclick: () => openPersonForm() }, icon('plus'), ' Add person')),
    search, list);

  let people = [];
  try {
    people = await api.people();
  } catch (e) {
    list.replaceChildren(h('p', { class: 'muted' }, `Could not load people: ${e.message}`));
    return;
  }

  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const shown = people.filter((p) => !q || p.name.toLowerCase().includes(q) || (p.notes || '').toLowerCase().includes(q));
    count.textContent = `${people.length} enrolled · ${people.reduce((n, p) => n + p.faceCount, 0)} samples`;
    if (!shown.length) {
      list.replaceChildren(h('div', { class: 'empty card' },
        h('strong', {}, people.length ? 'No matches' : 'No people yet'),
        h('p', { class: 'muted small' }, people.length
          ? 'Try a different search.'
          : 'Add a person, then give them a few photos or capture them from the camera.')));
      return;
    }
    list.replaceChildren(...shown.map((p) => h('a', { class: 'card person-card', href: `#/people/${p.id}` },
      h('div', { class: 'avatar', style: { background: p.color } }, initials(p.name)),
      h('div', { class: 'grow' },
        h('strong', {}, p.name),
        h('div', { class: 'muted small' }, `${p.faceCount} sample${p.faceCount === 1 ? '' : 's'}${p.notes ? ' · ' + p.notes : ''}`)),
      h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'))));
  };
  search.addEventListener('input', draw);
  draw();
}

function openPersonForm(person = null, onSaved) {
  let color = person?.color || PERSON_COLORS[0];
  const name = h('input', { class: 'input', maxlength: '80', value: person?.name || '', placeholder: 'Full name', autocomplete: 'off' });
  const notes = h('textarea', { class: 'input', rows: '3', maxlength: '2000', placeholder: 'Optional notes (role, team, etc.)' }, person?.notes || '');
  const swatches = h('div', { class: 'swatches' });
  const paint = () => swatches.replaceChildren(...PERSON_COLORS.map((c) => h('button', {
    class: `swatch ${c === color ? 'on' : ''}`, style: { background: c }, 'aria-label': `Color ${c}`,
    onclick: () => { color = c; paint(); },
  })));
  paint();

  openModal({
    title: person ? 'Edit person' : 'Add person',
    body: h('div', { class: 'stack' },
      h('div', { class: 'field' }, h('label', {}, 'Name'), name),
      h('div', { class: 'field' }, h('label', {}, 'Notes'), notes),
      h('div', { class: 'field' }, h('label', {}, 'Color'), swatches)),
    actions: [
      { label: 'Cancel' },
      {
        label: person ? 'Save' : 'Create',
        primary: true,
        onClick: async () => {
          const payload = { name: name.value.trim(), notes: notes.value.trim(), color };
          if (!payload.name) throw new Error('Name is required');
          const saved = person
            ? await api.updatePerson(person.id, payload)
            : await api.createPerson(payload);
          toast(person ? 'Person updated' : `${saved.name} added`, 'success');
          notifyGalleryChanged();
          if (onSaved) onSaved(saved);
          else location.hash = `#/people/${saved.id}`;
        },
      },
    ],
  });
}

// ---------- detail ----------
async function renderPerson(root, id) {
  let person;
  try {
    person = await api.person(id);
  } catch (e) {
    root.append(h('div', { class: 'card' }, h('p', {}, e.message), h('a', { href: '#/people' }, '← Back to people')));
    return;
  }

  const header = h('div', { class: 'person-head' });
  const samples = h('div', { class: 'thumbs' }, h('p', { class: 'muted' }, 'Loading samples…'));
  const sampleCount = h('span', { class: 'muted small' });
  const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });

  root.append(
    h('a', { class: 'back', href: '#/people' }, icon('back'), ' People'),
    header,
    h('div', { class: 'card' },
      h('div', { class: 'row between' },
        h('h2', {}, 'Face samples ', sampleCount),
      ),
      h('p', { class: 'muted small tip' },
        'Add 3–5 photos with varied lighting, angles, and expressions for best accuracy. One face per photo works best; the largest face is used.'),
      h('div', { class: 'row actions' },
        h('button', { class: 'btn primary', onclick: () => fileInput.click() }, icon('upload'), ' Upload photos'),
        h('button', { class: 'btn', onclick: () => openCapture() }, icon('camera'), ' Capture from camera')),
      fileInput,
      samples));

  fileInput.addEventListener('change', async () => {
    const files = [...fileInput.files];
    fileInput.value = '';
    if (!files.length) return;
    let ok = 0;
    let failed = 0;
    for (let i = 0; i < files.length; i++) {
      toast(`Processing ${i + 1} of ${files.length}…`, 'info', 1200);
      try {
        const { img, url } = await loadImage(files[i]);
        try {
          const r = await enrollFromSource(img, person.id, { accurate: true });
          r.ok ? ok++ : failed++;
        } finally {
          URL.revokeObjectURL(url);
        }
      } catch (e) {
        failed++;
      }
    }
    toast(`${ok} sample${ok === 1 ? '' : 's'} added${failed ? `, ${failed} skipped (no face found)` : ''}`,
      ok ? 'success' : 'error', 4500);
    notifyGalleryChanged();
    await loadSamples();
  });

  function paintHeader() {
    header.replaceChildren(
      h('div', { class: 'avatar lg', style: { background: person.color } }, initials(person.name)),
      h('div', { class: 'grow' },
        h('h1', {}, person.name),
        h('div', { class: 'muted small' }, person.notes || 'No notes'),
        h('div', { class: 'muted small' }, `Added ${fmtDate(person.createdAt)}`)),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => openPersonForm(person, (p) => { person = p; paintHeader(); }) }, 'Edit'),
        h('button', { class: 'btn danger', onclick: deletePerson }, 'Delete')));
  }

  async function loadSamples() {
    let faces = [];
    try {
      faces = await api.faces(person.id);
    } catch (e) {
      samples.replaceChildren(h('p', { class: 'muted' }, e.message));
      return;
    }
    person = await api.person(person.id);
    sampleCount.textContent = `(${faces.length})`;
    if (!faces.length) {
      samples.replaceChildren(h('div', { class: 'empty' }, 'No samples yet. Upload photos or capture from the camera.'));
      return;
    }
    samples.replaceChildren(...faces.map((f) => {
      const img = h('img', { alt: `Sample from ${fmtDate(f.createdAt)}`, loading: 'lazy' });
      api.thumbUrl(f.thumbUrl).then((u) => { if (u) img.src = u; else img.replaceWith(h('div', { class: 'no-thumb' }, 'No image')); });
      return h('div', { class: 'thumb' }, img,
        h('button', { class: 'icon-btn x', 'aria-label': 'Delete sample', onclick: () => removeSample(f.id) }, '×'));
    }));
  }

  async function removeSample(faceId) {
    const ok = await confirmDialog('Remove this face sample? The person stays enrolled.', { okLabel: 'Remove', danger: true });
    if (!ok) return;
    try {
      await api.deleteFace(faceId);
      notifyGalleryChanged();
      toast('Sample removed');
      await loadSamples();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function deletePerson() {
    const ok = await confirmDialog(`Delete ${person.name} and all of their face samples? This cannot be undone.`,
      { title: 'Delete person', okLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api.deletePerson(person.id);
      notifyGalleryChanged();
      toast(`${person.name} deleted`, 'success');
      location.hash = '#/people';
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function openCapture() {
    const video = h('video', { autoplay: true, playsinline: true, muted: true });
    const info = h('p', { class: 'muted small' }, 'Center the face and tap Capture. Turn slightly between shots.');
    const countEl = h('span', { class: 'muted' }, '0 captured');
    let added = 0;
    const capBtn = h('button', { class: 'btn primary big' }, icon('camera'), ' Capture');
    const mirror = getSettings().facing === 'user';
    video.classList.toggle('mirror', mirror);

    const modal = openModal({
      title: `Capture for ${person.name}`,
      body: h('div', { class: 'stack' },
        h('div', { class: 'stage small' }, video),
        info,
        h('div', { class: 'row between' }, capBtn, countEl)),
      actions: [{ label: 'Done', primary: true }],
      onClose: async () => {
        stopCamera(video);
        if (added) { notifyGalleryChanged(); await loadSamples(); }
      },
    });

    capBtn.addEventListener('click', async () => {
      capBtn.disabled = true;
      info.textContent = 'Analyzing…';
      try {
        await loadCoreModels();
        const dets = await detectFaces(video, { inputSize: 416 });
        if (!dets.length) {
          info.textContent = 'No face found. Move closer or improve the lighting.';
          return;
        }
        dets.sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height);
        const d = dets[0];
        await addSample(person.id, { descriptor: d.descriptor, image: cropFace(video, d.box), source: 'camera' });
        added++;
        countEl.textContent = `${added} captured`;
        info.textContent = 'Captured. Turn slightly for another angle.';
        toast('Sample captured', 'success', 1400);
      } catch (e) {
        toast(e.message, 'error');
        info.textContent = 'Something went wrong. Try again.';
      } finally {
        capBtn.disabled = false;
      }
    });

    startCamera(video, getSettings().facing).catch((e) => {
      info.textContent = e.message;
      capBtn.disabled = true;
    });
    return modal;
  }

  paintHeader();
  await loadSamples();
}
