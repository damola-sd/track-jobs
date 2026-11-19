import {
  STATUSES, getAll, saveApplication, deleteApplication, importApplications,
  toCSV, isFollowUpDue,
} from '../lib/storage.js';
import { setupForm, fillForm, readForm, formatDate, formatDateTime } from '../lib/form.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

const dialog = $('#editDialog');
const form = $('#editForm');
let apps = [];
let editingId = null;

// ---- Setup ----
setupForm(form);
$('#statusFilter').replaceChildren(
  new Option('All statuses', ''),
  ...STATUSES.map((s) => new Option(s, s)),
  new Option('Follow-up due', '__due'),
);
for (const id of ['search', 'statusFilter', 'sortBy']) $('#' + id).addEventListener('input', render);

// ---- Rendering ----
function filtered() {
  const q = $('#search').value.trim().toLowerCase();
  const status = $('#statusFilter').value;
  const sort = $('#sortBy').value;

  let list = apps.filter((a) => {
    if (status === '__due' ? !isFollowUpDue(a) : status && a.status !== status) return false;
    if (!q) return true;
    return [a.company, a.title, a.location, a.notes, a.source, a.contact, a.salary]
      .some((v) => v && v.toLowerCase().includes(q));
  });

  const byDate = (a, b) => new Date(b.appliedAt) - new Date(a.appliedAt);
  const sorters = {
    newest: byDate,
    oldest: (a, b) => byDate(b, a),
    company: (a, b) => (a.company || '').localeCompare(b.company || '') || byDate(a, b),
    status: (a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || byDate(a, b),
  };
  return list.sort(sorters[sort] || byDate);
}

function renderStats() {
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const count = (fn) => apps.filter(fn).length;
  const responded = count((a) => ['Interviewing', 'Offer', 'Rejected'].includes(a.status));
  const stats = [
    ['Total applications', apps.length],
    ['Last 7 days', count((a) => new Date(a.appliedAt) >= weekAgo)],
    ['Interviewing', count((a) => a.status === 'Interviewing')],
    ['Offers', count((a) => a.status === 'Offer')],
    ['Response rate', apps.length ? Math.round((responded / apps.length) * 100) + '%' : '—'],
    ['Follow-ups due', count(isFollowUpDue)],
  ];
  $('#stats').replaceChildren(...stats.map(([label, value]) =>
    el('div', { className: 'stat' }, el('div', { className: 'value', textContent: value }), el('div', { className: 'label', textContent: label }))));
}

function renderRow(a) {
  const status = el('select', { ariaLabel: 'Status' }, ...STATUSES.map((s) => new Option(s, s)));
  status.value = a.status;
  status.addEventListener('click', (e) => e.stopPropagation());
  status.addEventListener('change', () => saveApplication({ id: a.id, status: status.value }));

  const open = el('a', { href: a.url, target: '_blank', rel: 'noopener', textContent: 'Open ↗', title: a.url });
  open.addEventListener('click', (e) => e.stopPropagation());
  if (!/^https?:/i.test(a.url || '')) open.hidden = true;

  const del = el('button', { type: 'button', className: 'danger', textContent: 'Delete' });
  del.addEventListener('click', (e) => { e.stopPropagation(); confirmDelete(a); });

  const due = isFollowUpDue(a);
  const tr = el('tr', {},
    el('td', { className: 'date', textContent: formatDate(a.appliedAt), title: formatDateTime(a.appliedAt) }),
    el('td', { className: 'company', textContent: a.company || '—' }),
    el('td', { textContent: a.title || '—' }),
    el('td', { textContent: [a.location, (a.location || '').toLowerCase().includes((a.workMode || '').toLowerCase()) ? '' : a.workMode]
      .filter(Boolean).join(' · ') || '—' }),
    el('td', { textContent: a.source || '—' }),
    el('td', {}, status),
    el('td', { className: due ? 'due' : '', textContent: a.followUpAt ? formatDate(a.followUpAt) + (due ? ' • due' : '') : '' }),
    el('td', { className: 'row-actions' }, open, del),
  );
  tr.dataset.id = a.id;
  tr.addEventListener('click', () => openEditor(a));
  return tr;
}

function render() {
  renderStats();
  const list = filtered();
  $('#rows').replaceChildren(...list.map(renderRow));
  $('#subtitle').textContent = apps.length
    ? `Showing ${list.length} of ${apps.length}`
    : 'Click the extension icon on a job page to log your first application.';
  const empty = $('#empty');
  empty.hidden = list.length > 0;
  empty.textContent = apps.length ? 'No applications match your filters.' : 'No applications yet.';
}

async function load() {
  apps = await getAll();
  render();
}

// ---- Edit dialog ----
function openEditor(app) {
  editingId = app?.id || null;
  $('#dialogTitle').textContent = editingId ? 'Edit application' : 'Add application';
  $('#deleteBtn').hidden = !editingId;
  fillForm(form, app || { status: 'Applied', appliedAt: new Date().toISOString(), source: '' });

  const history = $('#history');
  if (app?.statusHistory?.length) {
    history.replaceChildren(
      el('strong', { textContent: 'Status history' }),
      el('ol', {}, ...app.statusHistory.map((h) => el('li', { textContent: `${h.status} — ${formatDateTime(h.at)}` }))),
    );
  } else {
    history.replaceChildren();
  }
  dialog.showModal();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = readForm(form);
  if (editingId) data.id = editingId;
  await saveApplication(data);
  dialog.close();
});
$('#cancelBtn').addEventListener('click', () => dialog.close());
$('#deleteBtn').addEventListener('click', () => {
  const app = apps.find((a) => a.id === editingId);
  if (app) confirmDelete(app);
});
$('#addBtn').addEventListener('click', () => openEditor(null));

async function confirmDelete(app) {
  if (!confirm(`Delete the application to ${app.company || 'this company'} — ${app.title || 'this role'}? This can't be undone.`)) return;
  await deleteApplication(app.id);
  if (dialog.open) dialog.close();
}

// ---- Import / export ----
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const stamp = () => new Date().toISOString().slice(0, 10);

$('#exportCsv').addEventListener('click', () =>
  download(`job-applications-${stamp()}.csv`, toCSV(filtered()), 'text/csv'));
$('#exportJson').addEventListener('click', () =>
  download(`job-applications-${stamp()}.json`, JSON.stringify(apps, null, 2), 'application/json'));

$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const added = await importApplications(JSON.parse(await file.text()));
    alert(`Imported ${added} application${added === 1 ? '' : 's'}.`);
  } catch (err) {
    alert(`Import failed: ${err.message}`);
  }
});

// ---- Live updates and deep links (#<id> from notifications) ----
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.applications) load();
});

await load();
const linked = location.hash.slice(1) && apps.find((a) => a.id === location.hash.slice(1));
if (linked) {
  const row = document.querySelector(`tr[data-id="${CSS.escape(linked.id)}"]`);
  row?.scrollIntoView({ block: 'center' });
  row?.classList.add('flash');
  openEditor(linked);
}
