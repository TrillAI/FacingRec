// Recognition log: history of identities seen by devices, plus server stats.
import { h, icon, toast, confirmDialog, fmtDate } from '../util.js';
import { api } from '../api.js';
import { flushPending, pendingCount } from '../events.js';
import { STATUS_LABEL } from '../engine.js';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'match', label: 'Recognized' },
  { id: 'possible', label: 'Possible' },
  { id: 'unknown', label: 'Unknown' },
];

export async function render(root) {
  let filter = 'all';
  let events = [];

  const stats = h('div', { class: 'stats' });
  const seg = h('div', { class: 'seg', role: 'tablist' });
  const list = h('div', { class: 'list' }, h('p', { class: 'muted' }, 'Loading…'));
  const pending = h('p', { class: 'muted small' });
  const syncBtn = h('button', { class: 'btn', onclick: sync }, 'Sync queued events');
  const offlineNote = h('p', { class: 'muted small', hidden: true });

  root.append(
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Recognition log'), h('p', { class: 'muted small' }, 'Identities seen by your devices. Repeats are throttled per person.')),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: load }, icon('refresh'), ' Refresh'),
        h('button', { class: 'btn danger', onclick: clearAll }, 'Clear'))),
    stats,
    h('div', { class: 'row between' }, seg),
    list,
    h('div', { class: 'card row between' }, pending, syncBtn),
    offlineNote);

  function paintSeg() {
    seg.replaceChildren(...FILTERS.map((f) => h('button', {
      role: 'tab', 'aria-selected': String(f.id === filter), class: f.id === filter ? 'on' : '',
      onclick: () => { filter = f.id; paintSeg(); paintList(); },
    }, f.label)));
  }

  function paintList() {
    const shown = events.filter((e) => filter === 'all' || e.status === filter);
    if (!shown.length) {
      list.replaceChildren(h('div', { class: 'empty' }, events.length ? 'Nothing in this filter.' : 'No events yet. Run live recognition to populate the log.'));
      return;
    }
    list.replaceChildren(...shown.map((e) => h('div', { class: 'log-row' },
      h('div', { class: 'grow' },
        h('strong', {}, e.label),
        h('div', { class: 'muted small' }, `${fmtDate(e.createdAt)} · ${e.device || 'device'}`)),
      h('div', { class: 'log-right' },
        h('span', { class: `badge ${e.status}` }, STATUS_LABEL[e.status] || e.status),
        e.distance != null ? h('div', { class: 'muted small' }, `d ${e.distance.toFixed(2)}`) : null))));
  }

  async function load() {
    try {
      const [s, ev] = await Promise.all([api.stats(), api.events(300)]);
      events = ev;
      stats.replaceChildren(
        statCard('Enrolled people', s.people),
        statCard('Face samples', s.faces),
        statCard('Events today', s.eventsToday),
        statCard('Total events', s.events));
      offlineNote.hidden = true;
      paintList();
    } catch (e) {
      offlineNote.hidden = false;
      offlineNote.textContent = `Server unavailable: ${e.message}. Showing nothing new.`;
    }
    const n = await pendingCount();
    pending.textContent = n ? `${n} event${n === 1 ? '' : 's'} queued on this device (offline).` : 'No queued events on this device.';
  }

  async function sync() {
    const sent = await flushPending();
    toast(sent ? `Synced ${sent} event${sent === 1 ? '' : 's'}` : 'Nothing to sync', sent ? 'success' : 'info');
    load();
  }

  async function clearAll() {
    const ok = await confirmDialog('Delete all recognition events from the server? Enrolled people are not affected.',
      { title: 'Clear log', okLabel: 'Clear', danger: true });
    if (!ok) return;
    try {
      await api.clearEvents();
      toast('Log cleared', 'success');
      load();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  paintSeg();
  await load();
  const timer = setInterval(load, 15000);
  return () => clearInterval(timer);
}

function statCard(label, value) {
  return h('div', { class: 'card stat' }, h('div', { class: 'stat-value' }, String(value ?? 0)), h('div', { class: 'muted small' }, label));
}
