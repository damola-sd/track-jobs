import { getAll, saveApplication, findMatches, detectSource } from '../lib/storage.js';
import { extractJobDetails } from '../lib/extract.js';
import { setupForm, fillForm, readForm, formatDateTime } from '../lib/form.js';

const $ = (sel) => document.querySelector(sel);
const form = $('#appForm');
let extracted = {};
let editingId = null;

const openDashboard = (hash = '') =>
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') + hash });

$('#openDashboard').addEventListener('click', () => openDashboard());
$('#savedDashboard').addEventListener('click', () => openDashboard());

async function init() {
  setupForm(form);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || '';

  if (tab?.id && /^https?:/.test(url)) {
    try {
      const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractJobDetails });
      extracted = res?.result || {};
    } catch (e) {
      console.warn('Could not read page:', e);
    }
  }

  fillForm(form, {
    url,
    company: extracted.company || '',
    title: extracted.title || tab?.title || '',
    location: extracted.location || '',
    workMode: extracted.workMode || '',
    salary: extracted.salary || '',
    source: detectSource(url),
    status: 'Applied',
    appliedAt: new Date().toISOString(),
  });
  $('#hint').hidden = !!(extracted.company || extracted.title);
  $('#descRow').hidden = !extracted.description;

  const matches = findMatches(await getAll(), url, extracted.company, extracted.title);
  if (matches.length) showDuplicate(matches[0], matches.length);

  form.elements[form.elements.company.value ? 'title' : 'company'].focus();
}

function showDuplicate(app, count) {
  const banner = $('#dupBanner');
  const p = document.createElement('p');
  p.textContent = `Already logged${count > 1 ? ` (${count} matches)` : ''}: ${app.company || '?'} — ${app.title || '?'}, ` +
    `${app.status}, applied ${formatDateTime(app.appliedAt)}.`;
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.textContent = 'Edit that entry';
  edit.addEventListener('click', () => {
    editingId = app.id;
    fillForm(form, app);
    $('#heading').textContent = 'Edit application';
    $('#submitBtn').textContent = 'Update application';
    $('#descRow').hidden = true;
    banner.hidden = true;
  });
  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.append(edit);
  banner.replaceChildren(p, actions);
  banner.hidden = false;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = readForm(form);
  if (editingId) data.id = editingId;
  else if ($('#saveDescription').checked && extracted.description) data.description = extracted.description;

  const saved = await saveApplication(data);
  form.hidden = true;
  $('#dupBanner').hidden = true;
  $('#hint').hidden = true;
  $('#savedTitle').textContent = `${saved.company} — ${saved.title}`;
  $('#savedSub').textContent = `${editingId ? 'Updated' : 'Saved'} · ${saved.status} · ${formatDateTime(saved.appliedAt)}`;
  $('#saved').hidden = false;
});

init();
