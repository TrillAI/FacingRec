// Enrollment: turning a detected face into a stored sample for a person.
import { api } from './api.js';
import { h, openModal, toast, cropFace } from './util.js';
import { notifyGalleryChanged } from './gallery.js';
import { detectFaces } from './engine.js';

// Store one face sample (128-d descriptor + optional thumbnail) for a person.
export function addSample(personId, { descriptor, image, source = 'camera' }) {
  return api.addFace(personId, { descriptor: Array.from(descriptor), image, source });
}

// Detect faces in any image-like source and enroll the largest one.
export async function enrollFromSource(source, personId, { accurate = true } = {}) {
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

// Find or create a person by name (case-insensitive). Returns the person id.
export async function resolvePerson(selectValue, newName) {
  if (selectValue !== '__new') return Number(selectValue);
  const name = (newName || '').trim();
  if (!name) throw new Error('Enter a name');
  try {
    const p = await api.createPerson({ name });
    return p.id;
  } catch (e) {
    if (e.status !== 409) throw e;
    const existing = (await api.people()).find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (!existing) throw e;
    return existing.id;
  }
}

// "Who is this?" dialog used after tapping a face or analyzing a photo.
export async function openEnrollDialog({ descriptor, image, source = 'camera', defaultPersonId = null, onSaved }) {
  let people = [];
  try {
    people = await api.people();
  } catch (e) {
    toast(e.message, 'error');
    return;
  }

  const select = h('select', { class: 'input' },
    h('option', { value: '__new' }, '+ New person…'),
    ...people.map((p) => h('option', { value: String(p.id), selected: p.id === defaultPersonId ? true : null },
      `${p.name} (${p.faceCount} samples)`)));
  const nameInput = h('input', { class: 'input', placeholder: 'Full name', maxlength: '80', autocomplete: 'off' });
  const nameField = h('div', { class: 'field' }, h('label', {}, 'Name'), nameInput);

  const syncField = () => { nameField.hidden = select.value !== '__new'; };
  select.addEventListener('change', syncField);
  if (!people.length) select.value = '__new';
  syncField();

  openModal({
    title: 'Enroll face',
    body: h('div', { class: 'stack' },
      image ? h('img', { class: 'enroll-thumb', src: image, alt: 'Face preview' }) : null,
      h('div', { class: 'field' }, h('label', {}, 'Who is this?'), select),
      nameField,
      h('p', { class: 'muted small' },
        'Each enrolled photo improves recognition. Add a few from different angles and lighting.')),
    actions: [
      { label: 'Cancel' },
      {
        label: 'Save',
        primary: true,
        onClick: async () => {
          const pid = await resolvePerson(select.value, nameInput.value);
          await addSample(pid, { descriptor, image, source });
          notifyGalleryChanged();
          toast('Face enrolled', 'success');
          onSaved?.(pid);
        },
      },
    ],
  });
}
